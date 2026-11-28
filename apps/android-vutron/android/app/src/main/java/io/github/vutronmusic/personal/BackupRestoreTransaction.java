package io.github.vutronmusic.personal;

import android.content.SharedPreferences;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Before-images for files and individual preference keys touched by one backup import. */
final class BackupRestoreTransaction {
    interface Work<T> { T run(BackupRestoreTransaction transaction) throws Exception; }
    private interface Undo { void run() throws Exception; }
    private final ArrayDeque<Undo> changes = new ArrayDeque<>();
    private final List<File> copies = new ArrayList<>();

    static <T> T run(Work<T> work) throws Exception {
        BackupRestoreTransaction transaction = new BackupRestoreTransaction();
        try {
            T result = work.run(transaction);
            for (File copy : transaction.copies) {
                if (copy.exists() && !copy.delete()) android.util.Log.w("VutronBackup", "Unable to remove an import rollback copy");
            }
            return result;
        } catch (Exception failure) {
            transaction.rollback(failure);
            if (failure.getSuppressed().length > 0) throw new IOException("备份导入失败，部分原有资料未能还原：" + failure.getMessage(), failure);
            throw failure;
        }
    }

    void rollback(Exception failure) {
        while (!changes.isEmpty()) {
            try { changes.pop().run(); }
            catch (Exception rollback) { failure.addSuppressed(rollback); }
        }
    }

    void beforeFile(File target) throws IOException {
        if (!target.exists()) {
            changes.push(() -> Files.deleteIfExists(target.toPath()));
            return;
        }
        File previous = File.createTempFile(".restore-", ".previous", target.getParentFile());
        try { Files.copy(target.toPath(), previous.toPath(), StandardCopyOption.REPLACE_EXISTING); }
        catch (IOException failure) {
            try { Files.deleteIfExists(previous.toPath()); } catch (IOException cleanup) { failure.addSuppressed(cleanup); }
            throw failure;
        }
        copies.add(previous);
        changes.push(() -> Files.move(previous.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING));
    }

    void beforePreferences(SharedPreferences prefs, Iterable<String> keys) {
        Map<String, ?> saved = prefs.getAll();
        Map<String, Object> previous = new HashMap<>();
        for (String key : keys) previous.put(key, saved.get(key));
        changes.push(() -> writePreferences(prefs, previous));
    }

    void preferences(SharedPreferences prefs, Map<String, Object> values) throws IOException {
        if (values.isEmpty()) return;
        beforePreferences(prefs, values.keySet());
        writePreferences(prefs, values);
    }

    @SuppressWarnings("unchecked")
    private static void writePreferences(SharedPreferences prefs, Map<String, Object> values) throws IOException {
        SharedPreferences.Editor edit = prefs.edit();
        for (Map.Entry<String, Object> entry : values.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();
            if (value == null) edit.remove(key);
            else if (value instanceof Boolean flag) edit.putBoolean(key, flag);
            else if (value instanceof Integer integer) edit.putInt(key, integer);
            else if (value instanceof Long number) edit.putLong(key, number);
            else if (value instanceof Float number) edit.putFloat(key, number);
            else if (value instanceof String text) edit.putString(key, text);
            else if (value instanceof Set<?>) edit.putStringSet(key, (Set<String>) value);
            else throw new IOException("不支持的备份设置类型");
        }
        if (!edit.commit()) throw new IOException("无法写入备份设置，请检查手机存储空间");
    }
}
