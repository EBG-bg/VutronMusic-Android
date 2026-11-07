package io.github.vutronmusic.personal;

import org.junit.Test;
import java.net.URI;
import static org.junit.Assert.*;

public class PluginArtworkTest {
    @Test public void cacheNamespacesSeparateInstancesAndAccountChanges() {
        assertNotEquals(PluginArtwork.cacheKey("emby", "https://host/art", 1), PluginArtwork.cacheKey("emby:home", "https://host/art", 1));
        assertNotEquals(PluginArtwork.cacheKey("emby", "https://host/art", 1), PluginArtwork.cacheKey("emby", "https://host/art", 2));
    }
    @Test public void localDesktopAssetsMatchOnlyTheirExactVirtualOrigin() throws Exception {
        assertTrue(PluginArtwork.isLocalAsset(new URI("http://localhost:41830/local-asset?trackId=a")));
        assertFalse(PluginArtwork.isLocalAsset(new URI("http://example.com:41830/local-asset?trackId=a")));
        assertFalse(PluginArtwork.isLocalAsset(new URI("http://localhost:80/local-asset?trackId=a")));
        assertFalse(PluginArtwork.isLocalAsset(new URI("http://localhost:41830/unrelated?trackId=a")));
    }
    @Test public void localAlbumIdentityMatchesTheSynchronizedDatabase() throws Exception {
        assertEquals("e8acd286ddd456a2d1186da83d8a184baac7ec2b43a1060612880550a3b14a27", AndroidPluginManager.digest("album:Test Album"));
        assertNotEquals(AndroidPluginManager.digest("album:Test Album"), AndroidPluginManager.digest("artist:Test Album"));
    }
}
