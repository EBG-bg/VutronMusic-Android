package io.github.vutronmusic.personal;

import org.junit.Test;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import static org.junit.Assert.*;

public class RuntimeBundleTest {
    private static final String NAME="sources-runtime-0280-node18204-v4";
    private static void text(File root,String path,String value) throws IOException {
        File file=new File(root,path);file.getParentFile().mkdirs();Files.write(file.toPath(),value.getBytes(StandardCharsets.UTF_8));
    }
    private static String text(File root,String path) throws IOException { return new String(Files.readAllBytes(new File(root,path).toPath()),StandardCharsets.UTF_8); }
    private static void valid(File directory,String value) throws IOException {
        text(directory,"server.js",value);text(directory,"node_modules/@unblockneteasemusic/server/src/provider/match.js","matcher");
    }
    @Test public void successfulInstallRemovesOnlyStaleGeneratedFilesAndPreservesExternalPluginState() throws Exception {
        File parent=Files.createTempDirectory("vutron-bundle-").toFile(),runtime=new File(parent,NAME);
        try {
            valid(runtime,"old");text(runtime,"node_modules/zod/stale.d.ts","stale");text(parent,"music-plugins-v1/local.state.json","private-state");
            EmbeddedSources.RuntimeBundle.install(runtime,"new-fingerprint",directory->valid(directory,"new"));
            assertEquals("new",text(runtime,"server.js"));assertEquals("new-fingerprint",text(runtime,".ready"));
            assertFalse(new File(runtime,"node_modules/zod/stale.d.ts").exists());
            assertEquals("private-state",text(parent,"music-plugins-v1/local.state.json"));
            assertFalse(new File(parent,NAME+".previous").exists());assertFalse(new File(parent,NAME+".installing").exists());
        } finally { delete(parent); }
    }
    @Test public void failedCopyAndIncompletePayloadLeaveThePreviousReadyBundleIntact() throws Exception {
        File parent=Files.createTempDirectory("vutron-bundle-failure-").toFile(),runtime=new File(parent,NAME);
        try {
            valid(runtime,"old");text(runtime,".ready","old-fingerprint");
            try { EmbeddedSources.RuntimeBundle.install(runtime,"new",directory->{text(directory,"partial","x");throw new IOException("Synthetic copy failure");});fail(); }
            catch(IOException expected){assertTrue(expected.getMessage().contains("Synthetic"));}
            assertEquals("old",text(runtime,"server.js"));assertEquals("old-fingerprint",text(runtime,".ready"));
            try { EmbeddedSources.RuntimeBundle.install(runtime,"new",directory->text(directory,"server.js","incomplete"));fail(); }
            catch(IOException expected){assertTrue(expected.getMessage().contains("不完整"));}
            assertEquals("old",text(runtime,"server.js"));assertFalse(new File(parent,NAME+".installing").exists());
        } finally { delete(parent); }
    }
    @Test public void interruptedCommitRestoresTheFixedPreviousDirectoryBeforeDeletingPartialStaging() throws Exception {
        File parent=Files.createTempDirectory("vutron-bundle-recover-").toFile(),runtime=new File(parent,NAME);
        try {
            valid(new File(parent,NAME+".previous"),"old");text(new File(parent,NAME+".installing"),"partial","x");
            text(parent,"audio-cache-v1/keep","audio");EmbeddedSources.RuntimeBundle.recover(runtime);
            assertEquals("old",text(runtime,"server.js"));assertEquals("audio",text(parent,"audio-cache-v1/keep"));
            assertFalse(new File(parent,NAME+".installing").exists());
            try { EmbeddedSources.RuntimeBundle.recover(new File(parent,"music-plugins-v1"));fail(); }
            catch(IOException expected){assertTrue(expected.getMessage().contains("固定"));}
        } finally { delete(parent); }
    }
    private static void delete(File file) throws IOException {
        File[] children=file.listFiles();if(children!=null)for(File child:children)delete(child);
        Files.deleteIfExists(file.toPath());
    }
}
