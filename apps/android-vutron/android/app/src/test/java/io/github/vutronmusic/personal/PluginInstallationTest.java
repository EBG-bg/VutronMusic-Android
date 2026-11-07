package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Collections;
import static org.junit.Assert.*;

public class PluginInstallationTest {
    private static JSONArray catalog() throws Exception {
        return new JSONArray().put(new JSONObject().put("id","local").put("name","Local").put("type","local").put("methods",new JSONArray().put("getAccount")))
                .put(new JSONObject().put("id","emby").put("name","Emby").put("type","stream").put("capabilities",new JSONObject().put("getLyric",true)));
    }
    private static JSONObject fresh() throws Exception { return new JSONObject().put("format",3).put("plugins",new JSONObject()); }
    @Test public void freshRegistryProvidesEveryBuiltinClosedWithoutExecutingCode() throws Exception {
        JSONObject value=AndroidPluginManager.reconcileRegistry(fresh(),catalog(),Collections.emptySet());
        assertEquals(3,value.getInt("format"));assertEquals(2,value.getJSONObject("plugins").length());
        JSONArray available=AndroidPluginManager.catalogProjection(catalog(),value.getJSONObject("plugins"));
        assertEquals(2,available.length());assertTrue(available.getJSONObject(0).getBoolean("installed"));
        assertFalse(available.getJSONObject(0).has("accountScope"));assertFalse(available.getJSONObject(0).has("store"));
        assertFalse(AndroidPluginManager.requireInstalled(value,"local").getBoolean("enabled"));
        try{AndroidPluginManager.requireEnabled(value,"local");fail();}catch(AndroidPluginManager.PluginFailure expected){assertEquals("PLUGIN_DISABLED",expected.code);}
        assertEquals("emby",AndroidPluginManager.requireInstanceBase(value,"emby").getString("id"));
    }
    @Test public void legacyInstallIsIdempotentAndOldBuiltinRemoveIsRejected() throws Exception {
        JSONObject value=fresh(),installed=AndroidPluginManager.installRegistry(value,catalog(),"emby");
        assertEquals("emby",installed.getString("baseId"));assertTrue(installed.getBoolean("builtIn"));assertFalse(installed.has("db"));
        installed.put("enabled",false).put("status","login");
        assertFalse(AndroidPluginManager.installRegistry(value,catalog(),"emby").getBoolean("enabled"));
        try{AndroidPluginManager.requireRemovable(value,"emby");fail();}catch(AndroidPluginManager.PluginFailure expected){assertEquals("PLUGIN_BUILTIN_PROVIDED",expected.code);}
        value.getJSONObject("plugins").remove("emby");
        JSONObject reconciled=AndroidPluginManager.reconcileRegistry(value,catalog(),Collections.emptySet());assertEquals(2,reconciled.getJSONObject("plugins").length());assertFalse(reconciled.getJSONObject("plugins").getJSONObject("emby").getBoolean("enabled"));
        assertEquals("logout",AndroidPluginManager.installRegistry(value,catalog(),"emby").getString("status"));
        try{AndroidPluginManager.installRegistry(value,catalog(),"not-in-catalog");fail();}catch(AndroidPluginManager.PluginFailure expected){assertEquals("PLUGIN_CATALOG",expected.code);}
    }
    @Test public void legacyRegisteredMetadataAndCustomInstancesArePreservedWhileMissingDefaultsStayClosed() throws Exception {
        JSONObject previous=fresh().put("format",1);previous.getJSONObject("plugins").put("emby",new JSONObject().put("id","emby").put("name","My server").put("enabled",false).put("status","login").put("createdAt",17))
                .put("user_custom",new JSONObject().put("id","user_custom").put("baseId","user_custom").put("name","Custom").put("builtIn",false))
                .put("user_custom:one",new JSONObject().put("id","user_custom:one").put("baseId","user_custom").put("builtIn",false));
        String untouched=previous.toString();JSONObject result=AndroidPluginManager.reconcileRegistry(previous,catalog(),Collections.emptySet());
        assertEquals(3,result.getInt("format"));assertEquals(4,result.getJSONObject("plugins").length());assertFalse(result.getJSONObject("plugins").getJSONObject("local").getBoolean("enabled"));
        JSONObject installed=result.getJSONObject("plugins").getJSONObject("emby");assertEquals("My server",installed.getString("name"));assertFalse(installed.getBoolean("enabled"));assertEquals("login",installed.getString("status"));assertEquals(17,installed.getLong("createdAt"));
        assertEquals(untouched,previous.toString());
    }
    @Test public void missingDefaultDefinitionsAreProvidedClosedWithoutRecoveringOldOrphanAccounts() throws Exception {
        JSONObject old=fresh().put("format",1);old.getJSONObject("plugins").put("emby:one",new JSONObject().put("id","emby:one").put("baseId","emby"));
        JSONObject migrated=AndroidPluginManager.reconcileRegistry(old,catalog(),Collections.singleton("local"));
        assertTrue(migrated.getJSONObject("plugins").has("emby"));assertTrue(migrated.getJSONObject("plugins").has("local"));
        assertFalse(migrated.getJSONObject("plugins").getJSONObject("emby").getBoolean("enabled"));assertFalse(migrated.getJSONObject("plugins").getJSONObject("local").getBoolean("enabled"));
        try{AndroidPluginManager.requireRemovable(migrated,"emby");fail();}catch(AndroidPluginManager.PluginFailure expected){assertEquals("PLUGIN_BUILTIN_PROVIDED",expected.code);}
        JSONObject orphan=fresh();orphan.getJSONObject("plugins").put("emby:one",new JSONObject().put("id","emby:one").put("baseId","emby"));
        JSONObject provided=AndroidPluginManager.reconcileRegistry(orphan.put("format",2),catalog(),Collections.emptySet());
        assertTrue(provided.getJSONObject("plugins").has("emby"));assertFalse(provided.getJSONObject("plugins").getJSONObject("emby").getBoolean("enabled"));
        assertEquals("emby",AndroidPluginManager.requireInstanceBase(provided,"emby:one").getString("id"));
    }
    @Test public void uninstallDeletesOnlyTheSelectedPluginPrivateFiles() throws Exception {
        File directory=Files.createTempDirectory("plugin-install-").toFile();
        try {
            for(String name:new String[]{"emby.state.json","emby.js","other.state.json","native-session","audio-cache"})Files.write(new File(directory,name).toPath(),name.getBytes(StandardCharsets.UTF_8));
            AndroidPluginManager.removePrivateFiles(directory,"emby");
            assertFalse(new File(directory,"emby.state.json").exists());assertFalse(new File(directory,"emby.js").exists());
            for(String name:new String[]{"other.state.json","native-session","audio-cache"})assertEquals(name,new String(Files.readAllBytes(new File(directory,name).toPath()),StandardCharsets.UTF_8));
            try{AndroidPluginManager.removePrivateFiles(directory,"../native-session");fail();}catch(AndroidPluginManager.PluginFailure expected){assertEquals("PLUGIN_ID",expected.code);}
        } finally {for(File file:directory.listFiles())Files.deleteIfExists(file.toPath());Files.deleteIfExists(directory.toPath());}
    }
    @Test public void failedRegistryCommitRestoresRemovedPrivateBytesAndKeepsTheInstalledEntry() throws Exception {
        File directory=Files.createTempDirectory("plugin-uninstall-rollback-").toFile();JSONObject value=fresh();AndroidPluginManager.installRegistry(value,catalog(),"emby").put("enabled",true);
        try {
            Files.write(new File(directory,"emby.state.json").toPath(),"original-account".getBytes(StandardCharsets.UTF_8));
            Files.write(new File(directory,"emby.js").toPath(),"original-source".getBytes(StandardCharsets.UTF_8));
            assertTrue(new File(directory,"registry.json").mkdir());
            try{AndroidPluginManager.resetRegistry(directory,value,"emby");fail();}catch(Exception expected){assertTrue(value.getJSONObject("plugins").getJSONObject("emby").getBoolean("enabled"));}
            assertEquals("original-account",new String(Files.readAllBytes(new File(directory,"emby.state.json").toPath()),StandardCharsets.UTF_8));
            assertEquals("original-source",new String(Files.readAllBytes(new File(directory,"emby.js").toPath()),StandardCharsets.UTF_8));
        } finally {for(File file:directory.listFiles())Files.deleteIfExists(file.toPath());Files.deleteIfExists(directory.toPath());}
    }
    @Test public void resetKeepsProvidedRowAndIndependentInstanceWhileClearingOnlySelectedPrivateData() throws Exception {
        File directory=Files.createTempDirectory("plugin-reset-").toFile();JSONObject value=AndroidPluginManager.reconcileRegistry(fresh(),catalog(),Collections.emptySet());
        value.getJSONObject("plugins").getJSONObject("emby").put("enabled",true).put("status","login");
        value.getJSONObject("plugins").put("emby_instance",new JSONObject().put("id","emby_instance").put("baseId","emby").put("builtIn",false).put("enabled",true));
        try {
            for(String name:new String[]{"emby.state.json","emby_instance.state.json","native-session","audio-cache","original.flac"})Files.write(new File(directory,name).toPath(),name.getBytes(StandardCharsets.UTF_8));
            AndroidPluginManager.resetRegistry(directory,value,"emby");assertFalse(new File(directory,"emby.state.json").exists());
            JSONObject source=value.getJSONObject("plugins").getJSONObject("emby");assertFalse(source.getBoolean("enabled"));assertEquals("logout",source.getString("status"));
            for(String name:new String[]{"emby_instance.state.json","native-session","audio-cache","original.flac"})assertEquals(name,new String(Files.readAllBytes(new File(directory,name).toPath()),StandardCharsets.UTF_8));
            assertTrue(value.getJSONObject("plugins").getJSONObject("emby_instance").getBoolean("enabled"));
        }finally{for(File file:directory.listFiles())Files.deleteIfExists(file.toPath());Files.deleteIfExists(directory.toPath());}
    }
    @Test public void orphanAccountsAreMovedWithoutReplacingAnExistingUniqueCopy() throws Exception {
        File directory=Files.createTempDirectory("plugin-orphans-").toFile(),isolated=new File(directory,"inactive-orphans");JSONObject previous=fresh();
        try {
            assertTrue(isolated.mkdir());File older=new File(isolated,"local.saved.state.json");Files.write(older.toPath(),"older-copy".getBytes(StandardCharsets.UTF_8));
            Files.write(new File(directory,"local.state.json").toPath(),"orphan-account".getBytes(StandardCharsets.UTF_8));
            AndroidPluginManager.quarantineOrphans(directory,previous,catalog());assertFalse(new File(directory,"local.state.json").exists());assertEquals(2,isolated.listFiles().length);
            assertEquals("older-copy",new String(Files.readAllBytes(older.toPath()),StandardCharsets.UTF_8));boolean found=false;for(File file:isolated.listFiles())if("orphan-account".equals(new String(Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8)))found=true;assertTrue(found);
            AndroidPluginManager.quarantineOrphans(directory,previous,catalog());assertEquals(2,isolated.listFiles().length);
        }finally{for(File file:isolated.listFiles())Files.deleteIfExists(file.toPath());Files.deleteIfExists(isolated.toPath());for(File file:directory.listFiles())Files.deleteIfExists(file.toPath());Files.deleteIfExists(directory.toPath());}
    }
    @Test public void closedLocalSourcesAreExcludedBeforeAnyLibrarySynchronization() throws Exception {
        JSONObject value=AndroidPluginManager.reconcileRegistry(fresh(),catalog(),Collections.emptySet()),entries=value.getJSONObject("plugins");
        entries.put("local:enabled",new JSONObject().put("id","local:enabled").put("baseId","local").put("type","local").put("enabled",true));entries.put("local:closed",new JSONObject().put("id","local:closed").put("baseId","local").put("type","local").put("enabled",false));
        JSONArray targets=AndroidPluginManager.enabledLocalIds(entries);assertEquals(1,targets.length());assertEquals("local:enabled",targets.getString(0));
        try{AndroidPluginManager.requireEnabled(value,"local");fail();}catch(AndroidPluginManager.PluginFailure expected){assertEquals("PLUGIN_DISABLED",expected.code);}
    }
}
