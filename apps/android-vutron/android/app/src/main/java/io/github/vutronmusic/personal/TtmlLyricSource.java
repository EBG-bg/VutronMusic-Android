package io.github.vutronmusic.personal;

import android.content.Context;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.io.StringReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** Exact NetEase-ID lookup in the community's CC0 AMLL database; never a title-only match. */
final class TtmlLyricSource {
    private static final int MAX_BYTES = 256 * 1024;
    private static final String METADATA = "http://www.w3.org/ns/ttml#metadata";
    private TtmlLyricSource() { }

    static LyricRepository.Lyrics enrich(Context context, long id, LyricRepository.Lyrics original) throws InterruptedIOException {
        if (id <= 0 || original.original.hasWordTiming() || LocalOnlyMode.enabled(context)
                || !MusicConnectivity.available(context)) return original;
        if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("Lyric lookup cancelled");
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(address(id)).openConnection();
            connection.setConnectTimeout(2500); connection.setReadTimeout(2500);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", "VutronMusic-Mobile/" + BuildConfig.VERSION_NAME);
            connection.setRequestProperty("Accept", "application/ttml+xml, application/xml, text/xml");
            if (connection.getResponseCode() != 200) return original;
            if (connection.getContentLengthLong() > MAX_BYTES) throw new IOException("TTML response exceeds its size limit");
            long deadline = System.nanoTime() + 5_000_000_000L;
            try (InputStream input = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("Lyric lookup cancelled");
                    if (System.nanoTime() > deadline || LocalOnlyMode.enabled(context)) throw new IOException("TTML lookup stopped");
                    if (bytes.size() + count > MAX_BYTES) throw new IOException("TTML response exceeds its size limit");
                    bytes.write(buffer, 0, count);
                }
                return choose(original, parse(bytes.toString(StandardCharsets.UTF_8.name()), id));
            }
        } catch (InterruptedIOException cancelled) {
            if (Thread.currentThread().isInterrupted()) throw cancelled;
            Log.d("VutronLyrics", "Community word timing unavailable: " + cancelled.getClass().getSimpleName());
        } catch (Exception unavailable) {
            Log.d("VutronLyrics", "Community word timing unavailable: " + unavailable.getClass().getSimpleName());
        } finally { if (connection != null) connection.disconnect(); }
        return original;
    }

    static String address(long id) {
        if (id <= 0) throw new IllegalArgumentException("Invalid lyric song ID");
        return "https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/ncm-lyrics/" + id + ".ttml";
    }

    static LyricRepository.Lyrics parse(String xml, long id) throws Exception {
        if (xml == null || xml.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IOException("TTML exceeds its size limit");
        // Reject DTD/entity declarations before parsing as well as disabling external resolution.
        if (xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY")) throw new IOException("TTML declarations are not supported");
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true); factory.setExpandEntityReferences(false);
        // Android's platform factory does not implement every JAXP feature.
        feature(factory, XMLConstants.FEATURE_SECURE_PROCESSING, true);
        feature(factory, "http://xml.org/sax/features/external-general-entities", false);
        feature(factory, "http://xml.org/sax/features/external-parameter-entities", false);
        javax.xml.parsers.DocumentBuilder builder = factory.newDocumentBuilder();
        builder.setEntityResolver((publicId, systemId) -> new InputSource(new StringReader("")));
        Element root = builder.parse(new InputSource(new StringReader(xml))).getDocumentElement();
        if (!"tt".equals(root.getLocalName())) throw new IOException("Invalid TTML root");
        NodeList metadata = root.getElementsByTagNameNS("*", "meta");
        boolean identified = false;
        for (int i = 0; i < metadata.getLength(); i++) {
            Element item = (Element) metadata.item(i);
            if ("ncmMusicId".equals(item.getAttribute("key")) && Long.toString(id).equals(item.getAttribute("value"))) identified = true;
        }
        if (!identified) throw new IOException("TTML song ID mismatch");
        JSONArray rows = new JSONArray(); NodeList paragraphs = root.getElementsByTagNameNS("*", "p");
        if (paragraphs.getLength() > 12000) throw new IOException("Too many TTML lines");
        for (int i = 0; i < paragraphs.getLength(); i++) {
            Element paragraph = (Element) paragraphs.item(i);
            long start = time(paragraph.getAttribute("begin")), end = time(paragraph.getAttribute("end"));
            if (start < 0 || end < start) continue;
            StringBuilder text = new StringBuilder(); JSONArray words = new JSONArray();
            readText(paragraph, text, words, start, end);
            if (text.toString().trim().isEmpty()) continue;
            StringBuilder timedText = new StringBuilder();
            for (int n = 0; n < words.length(); n++) timedText.append(words.getJSONObject(n).optString("word"));
            if (!timedText.toString().equals(text.toString())) words = new JSONArray();
            JSONObject row = new JSONObject().put("start", start / 1000d).put("end", end / 1000d)
                    .put("lyric", new JSONObject().put("text", text.toString()).put("info", words));
            NodeList spans = paragraph.getElementsByTagNameNS("*", "span");
            String translation = "";
            for (int n = 0; n < spans.getLength(); n++) {
                Element span = (Element) spans.item(n);
                if (!"x-translation".equals(role(span))) continue;
                String language = span.getAttributeNS(XMLConstants.XML_NS_URI, "lang");
                if (translation.isEmpty() || language.startsWith("zh")) translation = span.getTextContent().trim();
                if (language.startsWith("zh")) break;
            }
            if (!translation.isEmpty()) row.put("tlyric", new JSONObject().put("text", translation));
            rows.put(row);
        }
        return new LyricRepository.Lyrics(LyricTimeline.fromPlugin(rows, "lyric"), LyricTimeline.fromPlugin(rows, "tlyric"), false);
    }

    private static void readText(Element parent, StringBuilder text, JSONArray words, long lineStart, long lineEnd) throws Exception {
        NodeList children = parent.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node node = children.item(i);
            if (node.getNodeType() == Node.TEXT_NODE) {
                String value = node.getNodeValue();
                if (!value.trim().isEmpty() || !value.contains("\n")) {
                    text.append(value);
                    if (!value.isEmpty() && value.trim().isEmpty()) {
                        long cursor = words.length()==0 ? lineStart : words.getJSONObject(words.length()-1).optLong("end",lineStart);
                        words.put(new JSONObject().put("word",value).put("start",cursor).put("end",cursor));
                    }
                }
                continue;
            }
            if (!(node instanceof Element)) continue;
            Element span = (Element) node;
            String role = role(span);
            if (role.equals("x-translation") || role.equals("x-roman") || role.equals("x-bg")) continue;
            long start = time(span.getAttribute("begin")), end = time(span.getAttribute("end"));
            if (start >= lineStart && end >= start && end <= lineEnd && !hasTimedChild(span)) {
                String content = span.getTextContent(); text.append(content);
                if (!content.isEmpty()) words.put(new JSONObject().put("word", content).put("start", start).put("end", end));
            } else readText(span, text, words, lineStart, lineEnd);
        }
    }

    private static boolean hasTimedChild(Element element) {
        NodeList spans = element.getElementsByTagNameNS("*", "span");
        for (int i = 0; i < spans.getLength(); i++) if (((Element) spans.item(i)).hasAttribute("begin")) return true;
        return false;
    }
    private static String role(Element span) { return span.getAttributeNS(METADATA, "role"); }

    private static void feature(DocumentBuilderFactory factory, String name, boolean value) {
        try { factory.setFeature(name, value); }
        catch (javax.xml.parsers.ParserConfigurationException unsupported) { /* DTD rejection and entity resolver apply on every factory. */ }
    }

    static long time(String value) {
        if (value == null || !value.matches("(?:\\d+:){0,2}\\d+(?:\\.\\d{1,3})?s?")) return -1;
        String[] parts = value.replace("s", "").split(":");
        double seconds = 0;
        for (String part : parts) seconds = seconds * 60 + Double.parseDouble(part);
        return seconds <= 86_400 ? Math.round(seconds * 1000) : -1;
    }

    static LyricRepository.Lyrics choose(LyricRepository.Lyrics original, LyricRepository.Lyrics candidate) {
        if (original.original.hasWordTiming() || !candidate.original.hasWordTiming()
                || !candidate.original.hasComparableCoverage(original.original)) return original;
        // Reuse a plain translation only when its original text is unique and exactly equal.
        Map<String, String> translated = new HashMap<>(); Map<String, Integer> counts = new HashMap<>();
        for (int i = 0; i < original.original.lines.size(); i++) {
            String key = original.original.lines.get(i).text.trim();
            counts.put(key, counts.getOrDefault(key, 0) + 1);
            if (!original.translationAt(i).isEmpty()) translated.put(key, original.translationAt(i));
        }
        try {
            JSONArray rows = new JSONArray();
            for (int i = 0; i < candidate.original.lines.size(); i++) {
                LyricTimeline.Line line = candidate.original.lines.get(i);
                String text = candidate.translationAt(i), key = line.text.trim();
                if (text.isEmpty() && counts.getOrDefault(key, 0) == 1) text = translated.getOrDefault(key, "");
                if (!text.isEmpty()) rows.put(new JSONObject().put("start", line.time / 1000d).put("end", (line.time + line.duration) / 1000d)
                        .put("tlyric", new JSONObject().put("text", text)));
            }
            if (!translated.isEmpty() && rows.length()==0) return original;
            return new LyricRepository.Lyrics(candidate.original, LyricTimeline.fromPlugin(rows, "tlyric"), false);
        } catch (Exception impossible) { return original; }
    }
}
