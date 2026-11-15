package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class TtmlLyricSourceTest {
    private String document(String lines) {
        return "<tt xmlns=\"http://www.w3.org/ns/ttml\" xmlns:amll=\"http://www.example.com/ns/amll\" "
                + "xmlns:ttm=\"http://www.w3.org/ns/ttml#metadata\"><head><metadata>"
                + "<amll:meta key=\"ncmMusicId\" value=\"123\"/></metadata></head><body><div>" + lines + "</div></body></tt>";
    }
    private String line() {
        return "<p begin=\"1.000\" end=\"5.000\"><span begin=\"1.000\" end=\"2.000\">Hello</span> "
                + "<span begin=\"3.500\" end=\"4.000\">world</span><span ttm:role=\"x-translation\" xml:lang=\"zh-CN\">你好世界</span>"
                + "<span ttm:role=\"x-roman\">romanized</span></p>";
    }

    @Test public void exactIdTtmlRetainsWordPausesTranslationAndMillisecondsThroughTheBridge() throws Exception {
        LyricRepository.Lyrics lyrics = TtmlLyricSource.parse(document(line()), 123);
        assertEquals("Hello world", lyrics.original.lines.get(0).text);
        assertEquals("你好世界", lyrics.translationAt(0));
        assertEquals(3, lyrics.original.lines.get(0).words.size());
        assertEquals(3500, lyrics.original.lines.get(0).words.get(2).start);
        assertEquals(6f, lyrics.original.lines.get(0).highlightedCharacters(3000, 9000), 0f);
        LyricRepository.Lyrics restored = new LyricRepository.Lyrics(LyricPayload.encode(lyrics));
        assertEquals("Hello world", restored.original.lines.get(0).text);
        assertEquals(3500, restored.original.lines.get(0).words.get(2).start);
        assertEquals("你好世界", restored.translationAt(0));
    }

    @Test public void parserRejectsWrongIdExternalDeclarationsAndExcessiveInput() throws Exception {
        assertThrows(java.io.IOException.class, () -> TtmlLyricSource.parse(document(line()), 124));
        assertThrows(java.io.IOException.class, () -> TtmlLyricSource.parse("<!DOCTYPE tt [<!ENTITY secret SYSTEM 'file:///secret'>]>" + document(line()), 123));
        assertThrows(java.io.IOException.class, () -> TtmlLyricSource.parse(" ".repeat(256 * 1024 + 1), 123));
        assertThrows(IllegalArgumentException.class, () -> TtmlLyricSource.address(-1));
        assertEquals("https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/ncm-lyrics/123.ttml", TtmlLyricSource.address(123));
    }

    @Test public void timeFormatsKeepHoursFractionsAndExplicitEnds() {
        assertEquals(1234, TtmlLyricSource.time("1.234"));
        assertEquals(61234, TtmlLyricSource.time("1:01.234"));
        assertEquals(3661234, TtmlLyricSource.time("1:01:01.234"));
        assertEquals(1500, TtmlLyricSource.time("1.5s"));
        assertEquals(-1, TtmlLyricSource.time("-1"));
        assertEquals(-1, TtmlLyricSource.time("NaN"));
    }

    @Test public void realOfficialTimingWinsAndIncompleteCommunityLyricsNeverReplaceFullLyrics() throws Exception {
        LyricRepository.Lyrics timed = new LyricRepository.Lyrics(new JSONObject().put("yrc", "[1000,4000](1000,1000,0)Hello (3500,500,0)world"));
        LyricRepository.Lyrics community = TtmlLyricSource.parse(document(line()), 123);
        assertSame(timed, TtmlLyricSource.choose(timed, community));
        LyricRepository.Lyrics full = new LyricRepository.Lyrics(new JSONObject().put("lrc", "[00:01.000]Hello world\n[00:10.000]Another complete line"));
        assertSame(full, TtmlLyricSource.choose(full, community));
    }

    @Test public void onlyExactUniqueSourceTextTransfersAnExistingTranslation() throws Exception {
        LyricRepository.Lyrics plain = new LyricRepository.Lyrics(new JSONObject().put("lrc", "[00:01.000]Hello world")
                .put("tlyric", "[00:01.000]原有翻译"));
        String withoutTranslation = "<p begin=\"1\" end=\"5\"><span begin=\"1\" end=\"2\">Hello</span> <span begin=\"3.5\" end=\"4\">world</span></p>";
        LyricRepository.Lyrics selected = TtmlLyricSource.choose(plain, TtmlLyricSource.parse(document(withoutTranslation), 123));
        assertNotSame(plain, selected);
        assertEquals("原有翻译", selected.translationAt(0));
        assertTrue(selected.original.hasWordTiming());
    }

    private JSONArray plugin(boolean timed, String text, double start, double end) throws Exception {
        JSONObject lyric = new JSONObject().put("text", text);
        if (timed) lyric.put("info", new JSONArray().put(new JSONObject().put("word", text).put("start", Math.round(start*1000)).put("end", Math.round(end*1000))));
        return new JSONArray().put(new JSONObject().put("start", start).put("end", end).put("lyric", lyric));
    }
    @Test public void linkedPluginCandidatesPreferFullRealWordsAndKeepTheFirstCompleteTimedProvider() throws Exception {
        JSONArray plain = plugin(false, "Hello world", 1, 5), timed = plugin(true, "Hello world", 1, 5);
        assertSame(timed, PluginMedia.preferredLyrics(plain, timed));
        assertSame(timed, PluginMedia.preferredLyrics(timed, plugin(true, "Hello world", 1, 5)));
        assertSame(plain, PluginMedia.preferredLyrics(plain, plugin(true, "He", 1, 2)));
        assertSame(plain, PluginMedia.preferredLyrics(plain, plugin(false, "Hello world", 1, 5)));
    }
}
