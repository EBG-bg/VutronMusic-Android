package io.github.vutronmusic.personal;

import org.junit.Test;
import java.net.URI;
import static org.junit.Assert.*;

public class PluginArtworkTest {
    @Test public void cacheNamespacesSeparateInstancesAndAccountChanges() {
        assertNotEquals(PluginArtwork.cacheKey("emby", "https://host/art", 1), PluginArtwork.cacheKey("emby:home", "https://host/art", 1));
        assertNotEquals(PluginArtwork.cacheKey("emby", "https://host/art", 1), PluginArtwork.cacheKey("emby", "https://host/art", 2));
    }
    @Test public void thumbnailAliasesKeepScopeAndRemainIndependentOfTheirLargeSourceKey() {
        String key=PluginArtwork.thumbnailKey("emby","https://host/art",1,192);
        assertFalse(key.isEmpty());assertNotEquals(key,PluginArtwork.cacheKey("emby","https://host/art",1));
        assertNotEquals(key,PluginArtwork.thumbnailKey("emby:home","https://host/art",1,192));
        assertNotEquals(key,PluginArtwork.thumbnailKey("emby","https://host/art",2,192));
        assertNotEquals(key,PluginArtwork.thumbnailKey("emby","https://host/other",1,192));
        assertNotEquals(key,PluginArtwork.thumbnailKey("emby","https://host/art",1,96));
        assertEquals("",PluginArtwork.thumbnailKey("emby","https://host/art",1,512));
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
    @Test public void publicKugouTemplatesUseHttpsWithoutRewritingSignedOrCustomServers() {
        assertEquals("https://imge.kugou.com/stdmusic/512/cover.jpg", PluginArtwork.imageUri("http://imge.kugou.com/stdmusic/{size}/cover.jpg"));
        assertEquals("https://singerimg.kugou.com/uploadpic/512/cover.jpg", PluginArtwork.imageUri("http://singerimg.kugou.com/uploadpic/%7Bsize%7D/cover.jpg"));
        for (String original : new String[]{"http://custom.invalid/cover/{size}.jpg", "http://imge.kugou.com/stdmusic/64/cover.jpg?signature=one", "http://imge.kugou.com.evil.invalid/cover.jpg"})
            assertEquals(original, PluginArtwork.imageUri(original));
    }
    @Test public void originalPicContractsCanReturnNestedDataOrDirectUrl() throws Exception {
        assertEquals("https://imge.kugou.com/cover.jpg", PluginMedia.resolvedUrl(new org.json.JSONObject().put("code",200).put("data","https://imge.kugou.com/cover.jpg")));
        assertEquals("https://imge.kugou.com/cover.jpg", PluginMedia.resolvedUrl(new org.json.JSONObject().put("code",200).put("data",new org.json.JSONObject().put("url","https://imge.kugou.com/cover.jpg"))));
    }
    @Test public void nativePublicImageRouteIsLimitedToExactHttpsKugouImageCdns() {
        assertTrue(PluginArtwork.directPublicImage("https://imge.kugou.com/stdmusic/512/cover.jpg"));
        assertTrue(PluginArtwork.directPublicImage("https://c1.kgimg.com/stdmusic/512/cover.jpg"));
        for (String url : new String[]{"http://imge.kugou.com/cover.jpg", "https://imge.kugou.com.evil.invalid/cover.jpg",
                "https://imge.kugou.com:9443/cover.jpg", "https://imge.kugou.com/cover.jpg?token=private", "https://example.com/cover.jpg"})
            assertFalse(url, PluginArtwork.directPublicImage(url));
    }
}
