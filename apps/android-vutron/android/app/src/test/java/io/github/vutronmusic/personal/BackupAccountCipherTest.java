package io.github.vutronmusic.personal;

import org.json.JSONObject;
import org.junit.Test;
import java.io.IOException;
import java.util.Base64;
import static org.junit.Assert.*;

public class BackupAccountCipherTest {
    private final char[] password = "合成 backup 🗝 secret".toCharArray();
    private JSONObject sample() throws Exception {
        return new JSONObject().put("netease", new JSONObject().put("cookie", "synthetic-session-value"));
    }

    @Test public void portableRoundTripUsesFreshRandomnessAndOnlyPersistsCiphertext() throws Exception {
        JSONObject first = BackupAccountCipher.seal(sample(), password);
        JSONObject second = BackupAccountCipher.seal(sample(), password);
        assertFalse(first.toString().contains("synthetic-session-value"));
        assertFalse(first.toString().contains("netease"));
        for (String field : new String[]{"salt", "nonce", "data"}) assertNotEquals(first.getString(field), second.getString(field));
        assertEquals("synthetic-session-value", BackupAccountCipher.open(new JSONObject(first.toString()), password).getJSONObject("netease").getString("cookie"));
    }

    @Test public void wrongPasswordOrModifiedCiphertextYieldsNoAccountData() throws Exception {
        JSONObject sealed = BackupAccountCipher.seal(sample(), password);
        String wrong = assertThrows(IOException.class, () -> BackupAccountCipher.open(sealed, "synthetic-other-password".toCharArray())).getMessage();
        for (String field : new String[]{"salt", "nonce", "data"}) {
            JSONObject modified = new JSONObject(sealed.toString());
            byte[] bytes = Base64.getDecoder().decode(modified.getString(field)); bytes[0] ^= 1;
            modified.put(field, Base64.getEncoder().encodeToString(bytes));
            assertEquals(wrong, assertThrows(IOException.class, () -> BackupAccountCipher.open(modified, password)).getMessage());
        }
    }

    @Test public void preAndroid26ProviderFallbackMatchesIndependentUtf8Pbkdf2Vector() throws Exception {
        byte[] salt = new byte[16]; for (int i = 0; i < salt.length; i++) salt[i] = (byte) i;
        byte[] key = BackupAccountCipher.deriveWithMac("密碼🙂".toCharArray(), salt, 17);
        assertEquals("fbe14827b25cd1ab2097378afc3ea134b6acf4d96346e9a5a71639d8401fca6f", java.util.HexFormat.of().formatHex(key));
    }

    @Test public void malformedLengthVersionAndKdfParametersAreRejectedAtBoundary() throws Exception {
        JSONObject sealed = BackupAccountCipher.seal(sample(), password);
        assertThrows(IOException.class, () -> BackupAccountCipher.open(new JSONObject(sealed.toString()).put("iterations", 1), password));
        assertThrows(IOException.class, () -> BackupAccountCipher.open(new JSONObject(sealed.toString()).put("version", "1"), password));
        assertThrows(IOException.class, () -> BackupAccountCipher.open(new JSONObject(sealed.toString()).put("nonce", "!!!!"), password));
        assertThrows(IOException.class, () -> BackupAccountCipher.open(new JSONObject(sealed.toString()).put("data", "A".repeat(3_000_000)), password));
        assertThrows(IOException.class, () -> BackupAccountCipher.seal(sample(), "short".toCharArray()));
    }
}
