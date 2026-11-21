package io.github.vutronmusic.personal;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import static org.junit.Assert.*;

public class RuntimeMediaStartWatchTest {
    private static final String PATH = "/media/" + "a".repeat(48);

    @Test public void earlierRelayFailureUsesTheAuthenticatedLoopbackRequestAndPreservesDiagnostics() throws Exception {
        assertEquals("relay=failed, range, public DNS fallback, address_recovery", exchange("200 OK",
                "{\"code\":200,\"phase\":\"failed\",\"range\":true,\"bytes\":false,\"recoveredDns\":true,\"reason\":\"address_recovery\"}"));
    }

    @Test public void absenceOrAmbiguousResponsesLeaveTheMediaPlayerInCharge() throws Exception {
        assertEquals("", exchange("204 No Content", ""));
        assertEquals("", exchange("200 OK", "{\"code\":200,\"phase\":\"failed\",\"status\":416,\"reason\":\"http\"}"));
        assertEquals("", exchange("200 OK", "{\"code\":200,\"phase\":\"failed\",\"bytes\":true,\"reason\":\"connection\"}"));
    }

    @Test public void cancellationClosesTheLoopbackWaitBeforeAnyServerResponse() throws Exception {
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try (ServerSocket relay = newRelay(); EmbeddedSources.MediaStartWatch watch = watch(relay)) {
            Future<String> waiting = worker.submit(watch::awaitFailure);
            try (Socket connection = relay.accept()) {
                readRequest(connection);
                watch.close();
                assertEquals(-1, connection.getInputStream().read());
                assertEquals("", waiting.get(3, TimeUnit.SECONDS));
            }
        } finally { worker.shutdownNow(); }
    }

    private static String exchange(String status, String body) throws Exception {
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try (ServerSocket relay = newRelay(); EmbeddedSources.MediaStartWatch watch = watch(relay)) {
            Future<String> waiting = worker.submit(watch::awaitFailure);
            try (Socket connection = relay.accept()) {
                readRequest(connection);
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                String headers = "HTTP/1.1 " + status + "\r\nContent-Type: application/json\r\nContent-Length: " + bytes.length
                        + "\r\nConnection: close\r\n\r\n";
                connection.getOutputStream().write(headers.getBytes(StandardCharsets.US_ASCII));
                connection.getOutputStream().write(bytes);
                connection.getOutputStream().flush();
                return waiting.get(3, TimeUnit.SECONDS);
            }
        } finally { worker.shutdownNow(); }
    }

    private static void readRequest(Socket connection) throws Exception {
        connection.setSoTimeout(3_000);
        BufferedReader request = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.US_ASCII));
        assertEquals("GET /media-start-failure?path=" + PATH + " HTTP/1.1", request.readLine());
        boolean authorized = false;
        for (String line; (line = request.readLine()) != null && !line.isEmpty();) {
            authorized |= "Authorization: Bearer fixture".equalsIgnoreCase(line);
        }
        assertTrue(authorized);
    }

    private static ServerSocket newRelay() throws Exception {
        ServerSocket server = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"));
        server.setSoTimeout(3_000);
        return server;
    }

    private static EmbeddedSources.MediaStartWatch watch(ServerSocket relay) {
        return new EmbeddedSources.MediaStartWatch(relay.getLocalPort(), "fixture", PATH);
    }
}
