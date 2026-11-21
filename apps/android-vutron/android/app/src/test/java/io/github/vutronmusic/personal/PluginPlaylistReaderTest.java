package io.github.vutronmusic.personal;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

import static org.junit.Assert.*;

public class PluginPlaylistReaderTest {
    @Test public void completeIdIndexRestoresOrderAndDuplicateOccurrencesAcrossPages() throws Exception {
        JSONObject item = new JSONObject().put("id", "mix").put("sourceContext", new JSONObject().put("gid", "visible"));
        JSONObject detail = new JSONObject().put("id", "mix").put("trackCount", 4)
                .put("trackIds", new JSONArray(List.of("a", "b", "a", "c")))
                .put("tracks", new JSONArray().put(track("b"))).put("sourceContext", new JSONObject().put("cursor", "first"));
        AtomicInteger pages = new AtomicInteger();
        PluginPlaylistReader.Loaded read = PluginPlaylistReader.read(item, (method, params) -> {
            if ("getPlaylistDetail".equals(method)) {
                assertEquals("visible", params.getString("gid"));
                return new JSONObject().put("code", 200).put("data", detail);
            }
            assertEquals("getPlaylistTracks", method);
            assertEquals("mix", params.getString("id"));
            if (pages.getAndIncrement() == 0) {
                assertEquals("first", params.getJSONObject("sourceContext").getString("cursor"));
                return page("c", new JSONObject().put("cursor", "second"));
            }
            assertFalse(params.getBoolean("reset"));
            assertEquals("second", params.getString("cursor"));
            return page("a", new JSONObject().put("hasMore", false));
        }, (done, total) -> assertEquals(4, (int) total));
        assertEquals(2, pages.get());
        assertEquals(List.of("a", "b", "a", "c"), read.tracks().stream().map(row -> row.optString("id")).collect(Collectors.toList()));
    }

    @Test public void cursorFromDetailEnvelopeStartsAfterTheEmbeddedFirstPage() throws Exception {
        JSONObject item = new JSONObject().put("id", 122).put("sourceContext", new JSONObject().put("page", 1));
        JSONObject detail = new JSONObject().put("id", 122).put("trackCount", 2)
                .put("tracks", new JSONArray().put(track("first"))).put("sourceContext", new JSONObject().put("page", 1));
        PluginPlaylistReader.Loaded read = PluginPlaylistReader.read(item, (method, params) -> {
            if ("getPlaylistDetail".equals(method)) return new JSONObject().put("code", 200).put("data", detail)
                    .put("sourceContext", new JSONObject().put("page", 2));
            assertEquals(2, params.getInt("page"));
            return page("second", new JSONObject().put("page", 3));
        }, (done, total) -> { });
        assertEquals(List.of("first", "second"), read.tracks().stream().map(row -> row.optString("id")).collect(Collectors.toList()));
    }

    @Test public void knownFilteredKugouRowsStillAllowACompleteReading() throws Exception {
        JSONObject item = new JSONObject().put("id", "mix");
        JSONObject detail = new JSONObject().put("id", "mix").put("trackCount", 3)
                .put("tracks", new JSONArray()).put("sourceContext", new JSONObject().put("page", 1));
        PluginPlaylistReader.Loaded read = PluginPlaylistReader.read(item, (method, params) -> {
            if ("getPlaylistDetail".equals(method)) return new JSONObject().put("code", 200).put("data", detail);
            int page = params.getInt("page");
            return new JSONObject().put("code", 200).put("sourceContext", new JSONObject().put("page", page + 1))
                    .put("data", page == 1 ? new JSONArray() : new JSONArray().put(track("playable")))
                    .put("skippedUnavailableTracks", page == 1 ? 2 : 0);
        }, (done, total) -> { });
        assertEquals(1, read.tracks().size());
        assertEquals("playable", read.tracks().get(0).getString("id"));
    }

    @Test public void partialResponseAndRepeatedCursorCannotPublishACompleteSnapshot() throws Exception {
        JSONObject item = new JSONObject().put("id", "mix");
        JSONObject detail = new JSONObject().put("id", "mix").put("trackCount", 3)
                .put("tracks", new JSONArray()).put("sourceContext", new JSONObject().put("page", 1));
        for (JSONObject next : List.of(new JSONObject().put("page", 1), new JSONObject().put("hasMore", false))) {
            AtomicInteger pages = new AtomicInteger();
            assertThrows(IOException.class, () -> PluginPlaylistReader.read(item, (method, params) -> {
                if ("getPlaylistDetail".equals(method)) return new JSONObject().put("code", 200).put("data", detail);
                pages.incrementAndGet(); return page("only", next);
            }, (done, total) -> { }));
            assertEquals(1, pages.get());
        }
    }

    private static JSONObject track(String id) throws Exception {
        return new JSONObject().put("id", id).put("name", id).put("sourceContext", new JSONObject().put("id", id));
    }

    private static JSONObject page(String id, JSONObject cursor) throws Exception {
        return new JSONObject().put("code", 200).put("data", new JSONArray().put(track(id))).put("sourceContext", cursor);
    }
}
