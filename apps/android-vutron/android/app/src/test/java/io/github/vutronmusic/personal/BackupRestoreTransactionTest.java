package io.github.vutronmusic.personal;

import android.content.SharedPreferences;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.IOException;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import static org.junit.Assert.*;

public class BackupRestoreTransactionTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    @Test public void accountFailureAfterLibraryPublishRestoresFilesAndPreferences() throws Exception {
        var root = temporary.newFolder();
        var library = new java.io.File(root, "restored-playlists.json");
        var pluginAccount = new java.io.File(root, "plugin.state.json");
        var newlyCreated = new java.io.File(root, "registry.json");
        Files.write(library.toPath(), "old-library".getBytes(StandardCharsets.UTF_8));
        Files.write(pluginAccount.toPath(), "old-plugin-account".getBytes(StandardCharsets.UTF_8));
        Map<String,Object> settings = new HashMap<>(Map.of("theme", "dark", "columns", 2));
        Map<String,Object> session = new HashMap<>(Map.of("data", "old-session", "iv", "old-iv"));

        IOException failure = assertThrows(IOException.class, () -> BackupRestoreTransaction.run(transaction -> {
            transaction.beforeFile(library);
            Files.write(library.toPath(), "new-library".getBytes(StandardCharsets.UTF_8));
            transaction.preferences(preferences(settings), Map.of("theme", "light", "columns", 4));

            transaction.beforeFile(newlyCreated);
            Files.write(newlyCreated.toPath(), "new-registry".getBytes(StandardCharsets.UTF_8));
            transaction.beforeFile(pluginAccount);
            Files.write(pluginAccount.toPath(), "new-plugin-account".getBytes(StandardCharsets.UTF_8));
            transaction.preferences(preferences(session), Map.of("data", "new-session", "iv", "new-iv"));

            throw new IOException("injected account apply failure");
        }));

        assertEquals("injected account apply failure", failure.getMessage());
        assertEquals("old-library", new String(Files.readAllBytes(library.toPath()), StandardCharsets.UTF_8));
        assertEquals("old-plugin-account", new String(Files.readAllBytes(pluginAccount.toPath()), StandardCharsets.UTF_8));
        assertFalse(newlyCreated.exists());
        assertEquals("dark", settings.get("theme"));
        assertEquals(2, settings.get("columns"));
        assertEquals("old-session", session.get("data"));
        assertEquals("old-iv", session.get("iv"));
        assertEquals(2, root.listFiles().length);
    }

    private SharedPreferences preferences(Map<String,Object> saved) {
        return (SharedPreferences) Proxy.newProxyInstance(getClass().getClassLoader(),
                new Class<?>[]{SharedPreferences.class}, (proxy, method, arguments) -> {
                    if ("getAll".equals(method.getName())) return new HashMap<>(saved);
                    if ("edit".equals(method.getName())) {
                        Map<String,Object> pending = new HashMap<>();
                        Set<String> removed = new HashSet<>();
                        return Proxy.newProxyInstance(getClass().getClassLoader(),
                                new Class<?>[]{SharedPreferences.Editor.class}, (editor, action, values) -> {
                                    String name = action.getName();
                                    if (name.startsWith("put")) {
                                        pending.put((String) values[0], values[1]);
                                        removed.remove((String) values[0]);
                                        return editor;
                                    }
                                    if ("remove".equals(name)) {
                                        String key = (String) values[0];
                                        pending.remove(key);
                                        removed.add(key);
                                        return editor;
                                    }
                                    if ("clear".equals(name)) {
                                        removed.addAll(saved.keySet());
                                        pending.clear();
                                        return editor;
                                    }
                                    if ("commit".equals(name) || "apply".equals(name)) {
                                        for (String key : removed) saved.remove(key);
                                        saved.putAll(pending);
                                        return "commit".equals(name);
                                    }
                                    throw new UnsupportedOperationException(name);
                                });
                    }
                    throw new UnsupportedOperationException(method.getName());
                });
    }
}
