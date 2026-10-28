package com.daytracker.spotify;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.util.FileSystemUtils;

/** The public Spotify sign-in relay: no token needed, and it can only send the browser to this computer. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
		properties = { "daytracker.data-dir=" + SpotifyRelayApiTest.DATA_DIR,
				"daytracker.launch-token=test-launch-token-0123456789abcdef0123456789" })
class SpotifyRelayApiTest {

	static final String DATA_DIR = "target/test-data/spotify-relay";

	static {
		try {
			FileSystemUtils.deleteRecursively(Path.of(DATA_DIR));
		}
		catch (IOException ex) {
			throw new IllegalStateException(ex);
		}
	}

	private static final String STATE = "abcdefghijklmnopqrstuv.43821";

	private final HttpClient http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();

	@Value("${local.server.port}")
	int port;

	private HttpResponse<String> get(String pathAndQuery) throws Exception {
		return http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + pathAndQuery)).build(),
				HttpResponse.BodyHandlers.ofString());
	}

	@Test
	void aSignInAnswerIsPassedToTheAppOnTheSameComputer() throws Exception {
		HttpResponse<String> response = get("/spotify/callback?code=AQB-x_y.z~1&state=" + STATE);

		assertThat(response.statusCode()).isEqualTo(200);
		String target = "http://127.0.0.1:43821/callback?code=AQB-x_y.z%7E1&amp;state=abcdefghijklmnopqrstuv.43821";
		assertThat(response.body()).contains("<meta http-equiv=\"refresh\" content=\"0;url=" + target + "\">")
			.contains("href=\"" + target + "\"");
		assertThat(response.headers().firstValue("Cache-Control")).hasValueSatisfying(value -> assertThat(value).contains("no-store"));
		assertThat(response.headers().firstValue("Referrer-Policy")).hasValue("no-referrer");
	}

	@Test
	void aCancelledSignInIsPassedOnToo() throws Exception {
		HttpResponse<String> response = get("/spotify/callback?error=access_denied&state=" + STATE);

		assertThat(response.statusCode()).isEqualTo(200);
		assertThat(response.body()).contains("http://127.0.0.1:43821/callback?error=access_denied&amp;state=");
	}

	@Test
	void anythingElseIsRefusedAndNeverSendsTheBrowserElsewhere() throws Exception {
		String[] refused = {
			"/spotify/callback",
			"/spotify/callback?code=abc",
			"/spotify/callback?code=abc&state=short.43821",
			"/spotify/callback?code=abc&state=abcdefghijklmnopqrstuv",
			"/spotify/callback?code=abc&state=abcdefghijklmnopqrstuv.80",
			"/spotify/callback?code=abc&state=abcdefghijklmnopqrstuv.99999",
			"/spotify/callback?code=abc&state=abcdefghijklmnopqrstuv.evil.com",
			"/spotify/callback?code=abc&error=access_denied&state=" + STATE,
			"/spotify/callback?code=%3Cscript%3E&state=" + STATE,
			"/spotify/callback?error=Bad%20Thing&state=" + STATE,
		};
		for (String path : refused) {
			HttpResponse<String> response = get(path);
			assertThat(response.statusCode()).as(path).isEqualTo(400);
			assertThat(response.body()).as(path).doesNotContain("refresh").doesNotContain("href");
		}
	}

	@Test
	void theRestOfTheApiStillNeedsTheLaunchToken() throws Exception {
		assertThat(get("/api/v1/tasks").statusCode()).isEqualTo(401);
		assertThat(get("/spotify/other").statusCode()).isEqualTo(401);
	}

}
