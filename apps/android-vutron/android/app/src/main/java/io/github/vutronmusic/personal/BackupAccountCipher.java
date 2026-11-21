package io.github.vutronmusic.personal;

import org.json.JSONObject;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/** Portable v1 account envelope. All cryptographic parameters are fixed by its version. */
final class BackupAccountCipher {
    static final int MIN_PASSWORD = 8, MAX_PASSWORD = 256;
    private static final int ITERATIONS = 600_000, LIMIT = 2 * 1024 * 1024, TAG_BYTES = 16;
    private static final byte[] CONTEXT = "VutronMusic/mobile-backup/accounts/v1:PBKDF2-SHA256:AES-256-GCM".getBytes(StandardCharsets.US_ASCII);
    private static final SecureRandom RNG = new SecureRandom();
    private BackupAccountCipher() { }

    static JSONObject seal(JSONObject accounts, char[] password) throws Exception {
        checkPassword(password);
        byte[] clear = accounts.toString().getBytes(StandardCharsets.UTF_8);
        try {
            if (clear.length > LIMIT) throw new IOException("账号备份超过 2 MiB");
            byte[] salt = new byte[16], nonce = new byte[12];
            RNG.nextBytes(salt);
            RNG.nextBytes(nonce);
            byte[] ciphertext = cipher(Cipher.ENCRYPT_MODE, password, salt, nonce).doFinal(clear);
            Base64.Encoder encoder = Base64.getEncoder();
            return new JSONObject().put("version", 1).put("salt", encoder.encodeToString(salt))
                    .put("nonce", encoder.encodeToString(nonce)).put("data", encoder.encodeToString(ciphertext));
        } finally { Arrays.fill(clear, (byte) 0); }
    }

    static JSONObject open(JSONObject envelope, char[] password) throws Exception {
        checkPassword(password);
        if (envelope == null || !Integer.valueOf(1).equals(envelope.opt("version")) || envelope.length() != 4) throw invalid();
        byte[] salt = decode(envelope.opt("salt"), 16, 16), nonce = decode(envelope.opt("nonce"), 12, 12);
        byte[] data = decode(envelope.opt("data"), 2 + TAG_BYTES, LIMIT + TAG_BYTES);
        byte[] clear;
        try { clear = cipher(Cipher.DECRYPT_MODE, password, salt, nonce).doFinal(data); }
        catch (javax.crypto.BadPaddingException badPasswordOrTamper) { throw new IOException("备份密码不正确，或账号资料已损坏"); }
        try { return new JSONObject(new String(clear, StandardCharsets.UTF_8)); }
        catch (org.json.JSONException badPayload) { throw invalid(); }
        finally { Arrays.fill(clear, (byte) 0); }
    }

    private static void checkPassword(char[] password) throws IOException {
        if (password == null || password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) throw new IOException("备份密码长度应为 8 至 256 个字符");
    }

    private static IOException invalid() { return new IOException("加密账号资料格式无效"); }

    private static byte[] decode(Object value, int minimum, int maximum) throws IOException {
        if (!(value instanceof String)) throw invalid();
        String text = (String) value;
        if (text.length() < (minimum + 2) / 3 * 4 || text.length() > (maximum + 2) / 3 * 4) throw invalid();
        try {
            byte[] bytes = Base64.getDecoder().decode(text);
            if (bytes.length < minimum || bytes.length > maximum) throw invalid();
            return bytes;
        } catch (IllegalArgumentException invalidBase64) { throw invalid(); }
    }

    private static Cipher cipher(int mode, char[] password, byte[] salt, byte[] nonce) throws Exception {
        PBEKeySpec spec = new PBEKeySpec(password, salt, ITERATIONS, 256);
        byte[] raw = null;
        try {
            try { raw = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(); }
            catch (NoSuchAlgorithmException oldAndroid) { raw = deriveWithMac(password, salt, ITERATIONS); }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(mode, new SecretKeySpec(raw, "AES"), new GCMParameterSpec(TAG_BYTES * 8, nonce));
            cipher.updateAAD(CONTEXT);
            return cipher;
        } finally {
            spec.clearPassword();
            if (raw != null) Arrays.fill(raw, (byte) 0);
        }
    }

    // Older Android releases have HmacSHA256 but lack its SecretKeyFactory alias.
    // RFC 8018 section 5.2, one 32-byte block for AES-256. Reuse both PRF buffers.
    static byte[] deriveWithMac(char[] password, byte[] salt, int rounds) throws GeneralSecurityException {
        ByteBuffer utf8 = StandardCharsets.UTF_8.encode(CharBuffer.wrap(password));
        byte[] encoded = new byte[utf8.remaining()]; utf8.get(encoded);
        if (utf8.hasArray()) Arrays.fill(utf8.array(), (byte) 0);
        Mac mac = Mac.getInstance("HmacSHA256");
        try { mac.init(new SecretKeySpec(encoded, "HmacSHA256")); }
        finally { Arrays.fill(encoded, (byte) 0); }
        mac.update(salt);
        byte[] previous = mac.doFinal(new byte[]{0, 0, 0, 1});
        byte[] next = new byte[previous.length], key = previous.clone();
        try {
            for (int round = 1; round < rounds; round++) {
                mac.update(previous); mac.doFinal(next, 0);
                for (int i = 0; i < key.length; i++) key[i] ^= next[i];
                byte[] swap = previous; previous = next; next = swap;
            }
            return key;
        } finally {
            Arrays.fill(previous, (byte) 0);
            Arrays.fill(next, (byte) 0);
        }
    }
}
