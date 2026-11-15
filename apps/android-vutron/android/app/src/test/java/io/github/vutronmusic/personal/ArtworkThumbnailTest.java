package io.github.vutronmusic.personal;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import static org.junit.Assert.*;

public class ArtworkThumbnailTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private static final String HASH = "a".repeat(64);

    @Test public void requestBucketsResizeOnlyNeteaseAndPreserveOtherSignedUrls() {
        String source = "http://p1.music.126.net/art.jpg?token=a%2Fb&param=100y100#part";
        for (int size : new int[]{96,192,320,512})
            assertEquals("https://p1.music.126.net/art.jpg?token=a%2Fb&param="+size+"y"+size+"#part", ArtworkSource.requestUrl(source,size));
        assertEquals(ArtworkSource.requestUrl(source),ArtworkSource.requestUrl(source,0));
        assertEquals(ArtworkSource.requestUrl(source),ArtworkSource.requestUrl(source,8192));
        for (String other : new String[]{"https://cdn.invalid/art.jpg?token=a%2Fb", "http://music.126.net.evil.invalid/art.jpg", "https://imge.kugou.com/stdmusic/512/art.jpg"})
            assertEquals(other,ArtworkSource.requestUrl(other,96));
    }

    @Test public void onlyExistingCanonicalOwnedImagesCanBeRead() throws Exception {
        File files=temporary.newFolder("files"),cache=new File(files,"artwork-cache-v1");assertTrue(cache.mkdir());
        File owned=new File(cache,HASH+".img");Files.write(owned.toPath(),new byte[]{1});
        assertEquals(owned.getCanonicalFile(),ArtworkThumbnail.ownedFile(files,owned.toURI().toString()));
        File outside=new File(files,HASH+".img");Files.write(outside.toPath(),new byte[]{2});
        File nested=new File(cache,"nested");assertTrue(nested.mkdir());File nestedImage=new File(nested,HASH+".img");Files.write(nestedImage.toPath(),new byte[]{3});
        File named=new File(cache,"original.img");Files.write(named.toPath(),new byte[]{4});
        File part=new File(cache,HASH+".img.part");Files.write(part.toPath(),new byte[]{5});
        for (File file : new File[]{outside,nestedImage,named,part,new File(cache,"b".repeat(64)+".img")})
            assertNull(file.toString(),ArtworkThumbnail.ownedFile(files,file.toURI().toString()));
        assertNull(ArtworkThumbnail.ownedFile(files,"https://example.com/a.img"));
        assertNull(ArtworkThumbnail.ownedFile(files,"content://documents/1"));
        assertNull(ArtworkThumbnail.ownedFile(files,owned.toURI()+"?ignored=true"));
        assertNull(ArtworkThumbnail.ownedFile(files,new File(cache,"../"+HASH+".img").toURI().toString()));
        File missing=new File(cache,"b".repeat(64)+".img");
        assertEquals(missing.getCanonicalFile(),ArtworkThumbnail.ownedPath(files,missing.toURI().toString()));
        assertNull(ArtworkThumbnail.ownedFile(files,missing.toURI().toString()));
    }

    @Test public void derivedIdentityChangesWithContentVersionAndBucket() throws Exception {
        File source=temporary.newFile("source.img");Files.write(source.toPath(),new byte[]{1});assertTrue(source.setLastModified(100000));
        String first=ArtworkThumbnail.key(source,96);
        assertEquals(first,ArtworkThumbnail.key(source,96));assertNotEquals(first,ArtworkThumbnail.key(source,192));
        Files.write(source.toPath(),new byte[]{1,2});assertTrue(source.setLastModified(100000));
        String resized=ArtworkThumbnail.key(source,96);assertNotEquals(first,resized);
        assertTrue(source.setLastModified(200000));assertNotEquals(resized,ArtworkThumbnail.key(source,96));
        File other=temporary.newFile("other.img");Files.write(other.toPath(),new byte[]{1,2});assertTrue(other.setLastModified(200000));
        assertNotEquals(ArtworkThumbnail.key(source,96),ArtworkThumbnail.key(other,96));
    }

    @Test public void sampledDecodeIsBoundedBeforeFinalScalingEvenForHugeAspectRatios() {
        for (int size : new int[]{96,192,320,512}) for (int[] image : new int[][]{{4000,3000},{12000,1},{1,12000},{Integer.MAX_VALUE,1000},{50,50}}) {
            int sample=ArtworkThumbnail.sampleSize(image[0],image[1],size);
            assertTrue(sample>0 && (sample & (sample-1))==0);
            assertTrue(image[0]/sample<=size*2 && image[1]/sample<=size*2);
            if (sample>1) assertTrue(image[0]/(sample/2)>size*2 || image[1]/(sample/2)>size*2);
        }
        assertEquals(32,ArtworkThumbnail.sampleSize(4000,3000,96));
        assertEquals(1,ArtworkThumbnail.sampleSize(50,50,96));
    }

    @Test public void animationAndUnsupportedFormatsRemainOriginal() {
        assertTrue(ArtworkThumbnail.supportedMime("image/jpeg"));assertTrue(ArtworkThumbnail.supportedMime("image/png"));
        for (String mime : new String[]{"image/gif","image/webp","image/avif","image/svg+xml",null}) assertFalse(ArtworkThumbnail.supportedMime(mime));
    }

    @Test public void pngAnimationControlBeforePixelsKeepsApngAndRejectsUnknownHeaders() throws Exception {
        File still=temporary.newFile("still.png"),animated=temporary.newFile("animated.png"),invalid=temporary.newFile("invalid.png");
        writePngHeader(still,false);writePngHeader(animated,true);Files.write(invalid.toPath(),new byte[]{1,2,3,4});
        assertFalse(ArtworkThumbnail.pngHasAnimation(still));assertTrue(ArtworkThumbnail.pngHasAnimation(animated));
        assertThrows(IOException.class,()->ArtworkThumbnail.pngHasAnimation(invalid));
    }

    @Test public void offlineLargeViewsCanReuseSmallerNeteaseCoversWithoutScanningOrRewritingOtherOrigins() throws Exception {
        File cache=temporary.newFolder("variant-cache");String source="https://p2.music.126.net/art.jpg";
        assertNull(ArtworkCache.offlineVariant(cache,source));
        File small=cachedVariant(cache,source,192);assertEquals(small,ArtworkCache.offlineVariant(cache,source));
        assertEquals(small,ArtworkCache.offlineVariant(cache,ArtworkSource.requestUrl(source,512)));
        File larger=cachedVariant(cache,source,320);assertEquals(larger,ArtworkCache.offlineVariant(cache,source));
        File full=cachedVariant(cache,source,512);assertEquals(full,ArtworkCache.offlineVariant(cache,source));
        String signed="https://cdn.invalid/art.jpg?token=keep";cachedVariant(cache,signed,192);
        assertNull(ArtworkCache.offlineVariant(cache,signed));
    }

    @Test public void thumbnailAliasSurvivesLargeSourceEvictionAndNeverSelfHitsDownloadedImage() throws Exception {
        File cache=temporary.newFolder("derived-cache");String source="https://p2.music.126.net/art.jpg";
        File full=cachedVariant(cache,source,512);
        String aliasKey=ArtworkCache.thumbnailKey(source,192);
        assertFalse(aliasKey.isEmpty());assertNotEquals(ArtworkSource.requestUrl(source,192),aliasKey);
        File thumbnail=cachedKey(cache,aliasKey);
        assertEquals(thumbnail,ArtworkCache.cachedThumbnail(cache,source,192));
        assertTrue(full.delete());
        assertEquals(thumbnail,ArtworkCache.offlineVariant(cache,source));
        assertEquals(thumbnail,ArtworkCache.offlineVariant(cache,ArtworkSource.requestUrl(source,512)));
        assertEquals("",ArtworkCache.thumbnailKey(source,512));
        assertEquals("",ArtworkCache.thumbnailKey("https://private.invalid/cover?token=one",192));
    }

    private static File cachedVariant(File directory,String source,int size) throws Exception {
        return cachedKey(directory,ArtworkSource.requestUrl(source,size));
    }

    private static File cachedKey(File directory,String identity) throws Exception {
        byte[] hash=java.security.MessageDigest.getInstance("SHA-256").digest(identity.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder key=new StringBuilder();for(byte value:hash)key.append(String.format(java.util.Locale.ROOT,"%02x",value&255));
        File file=new File(directory,key+".img");Files.write(file.toPath(),new byte[]{1});return file;
    }

    private static void writePngHeader(File file,boolean animated) throws IOException {
        try(DataOutputStream out=new DataOutputStream(new FileOutputStream(file))) {
            out.writeLong(0x89504e470d0a1a0aL);out.writeInt(13);out.writeInt(0x49484452);out.write(new byte[17]);
            if(animated){out.writeInt(8);out.writeInt(0x6163544c);out.write(new byte[12]);}
            out.writeInt(0);out.writeInt(0x49444154);out.writeInt(0);
        }
    }
}
