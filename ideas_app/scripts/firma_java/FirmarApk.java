// Firma y verifica una APK con la biblioteca oficial apksig (esquema v2; minSdk 26 no necesita v1).
// Uso: java -cp apksig.jar:. FirmarApk <entrada.apk> <salida.apk> <almacen> <alias> <clave>
import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collections;

public class FirmarApk {
    public static void main(String[] args) throws Exception {
        File in = new File(args[0]), out = new File(args[1]);
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (FileInputStream stream = new FileInputStream(args[2])) { store.load(stream, args[4].toCharArray()); }
        PrivateKey key = (PrivateKey) store.getKey(args[3], args[4].toCharArray());
        X509Certificate cert = (X509Certificate) store.getCertificate(args[3]);
        ApkSigner.SignerConfig signer = new ApkSigner.SignerConfig.Builder("CERT", key, Collections.singletonList(cert)).build();
        new ApkSigner.Builder(Collections.singletonList(signer)).setInputApk(in).setOutputApk(out)
            .setV1SigningEnabled(false).setV2SigningEnabled(true).setMinSdkVersion(26).build().sign();
        ApkVerifier.Result result = new ApkVerifier.Builder(out).build().verify();
        if (!result.isVerified()) {
            result.getErrors().forEach(e -> System.err.println("ERROR: " + e));
            throw new IllegalStateException("La firma no se pudo verificar.");
        }
        System.out.println("Firma verificada: v1=" + result.isVerifiedUsingV1Scheme() + " v2=" + result.isVerifiedUsingV2Scheme()
            + " certificado SHA-256=" + hex(java.security.MessageDigest.getInstance("SHA-256").digest(result.getSignerCertificates().get(0).getEncoded())));
    }
    private static String hex(byte[] b) { StringBuilder s = new StringBuilder(); for (byte x : b) s.append(String.format("%02x", x)); return s.toString(); }
}
