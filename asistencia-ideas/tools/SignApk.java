import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collections;

/**
 * Firma (esquema v2) y verifica un APK con la biblioteca oficial apksig.
 * La app tiene minSdkVersion 26: Android 7.0+ usa la firma v2, así que la v1 (JAR) no hace falta.
 *   java -cp apksig.jar:. SignApk sign  <entrada.apk> <salida.apk> <keystore.p12> <clave> <alias>
 *   java -cp apksig.jar:. SignApk verify <archivo.apk>
 * apksig conserva la alineación de 4 bytes de las entradas sin comprimir (resources.arsc incluido).
 */
public class SignApk {
  public static void main(String[] args) throws Exception {
    if (args.length >= 2 && args[0].equals("verify")) { verify(new File(args[1])); return; }
    if (args.length != 6 || !args[0].equals("sign")) {
      System.err.println("Uso: sign <in> <out> <keystore.p12> <clave> <alias> | verify <apk>");
      System.exit(2);
    }
    KeyStore ks = KeyStore.getInstance("PKCS12");
    try (FileInputStream in = new FileInputStream(args[3])) { ks.load(in, args[4].toCharArray()); }
    PrivateKey key = (PrivateKey) ks.getKey(args[5], args[4].toCharArray());
    X509Certificate cert = (X509Certificate) ks.getCertificate(args[5]);
    ApkSigner.SignerConfig signer = new ApkSigner.SignerConfig.Builder("IDEAS", key, Collections.singletonList(cert)).build();
    new ApkSigner.Builder(Collections.singletonList(signer))
        .setInputApk(new File(args[1]))
        .setOutputApk(new File(args[2]))
        .setV1SigningEnabled(false)
        .setV2SigningEnabled(true)
        .build()
        .sign();
    verify(new File(args[2]));
  }

  static void verify(File apk) throws Exception {
    ApkVerifier.Result r = new ApkVerifier.Builder(apk).setMinCheckedPlatformVersion(26).build().verify();
    System.out.println("verificado=" + r.isVerified() + " v2=" + r.isVerifiedUsingV2Scheme());
    for (ApkVerifier.IssueWithParams e : r.getErrors()) System.out.println("ERROR: " + e);
    for (ApkVerifier.IssueWithParams w : r.getWarnings()) System.out.println("AVISO: " + w);
    for (X509Certificate c : r.getSignerCertificates()) System.out.println("certificado: " + c.getSubjectX500Principal());
    if (!r.isVerified()) System.exit(1);
  }
}
