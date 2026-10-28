package com.daytracker.spotify;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.HtmlUtils;

/**
 * The public HTTPS address Spotify sends the browser back to after sign-in, for a
 * Spotify app whose dashboard refuses loopback redirect URIs. It does nothing but
 * pass the answer on to the Day Tracker window waiting on the same computer as the
 * browser, at http://127.0.0.1:PORT/callback, where the port travels inside the
 * state parameter ("random.port").
 *
 * Nothing is stored or logged, and no token is ever seen here: the desktop app uses
 * PKCE, so the code is useless without the verifier that never leaves it. The only
 * place this page can send the browser is the loopback address, so it cannot be
 * used to redirect anywhere else.
 */
@RestController
public class SpotifyRelayController {

	private static final Pattern STATE = Pattern.compile("[A-Za-z0-9_-]{16,64}\\.(\\d{4,5})");

	private static final Pattern CODE = Pattern.compile("[A-Za-z0-9._~-]{1,2048}");

	private static final Pattern ERROR = Pattern.compile("[a-z_]{1,64}");

	@GetMapping("/spotify/callback")
	ResponseEntity<String> callback(@RequestParam(required = false) String code,
			@RequestParam(required = false) String state, @RequestParam(required = false) String error) {
		Matcher matcher = state == null ? null : STATE.matcher(state);
		boolean valid = matcher != null && matcher.matches()
				&& (code == null) != (error == null)
				&& (code == null || CODE.matcher(code).matches())
				&& (error == null || ERROR.matcher(error).matches());
		int port = valid ? Integer.parseInt(matcher.group(1)) : 0;
		if (!valid || port < 1024 || port > 65535) {
			return page(HttpStatus.BAD_REQUEST, "This is not a Day Tracker sign-in answer.", null);
		}
		String target = "http://127.0.0.1:" + port + "/callback?"
				+ (code != null ? "code=" + encode(code) : "error=" + encode(error)) + "&state=" + encode(state);
		return page(HttpStatus.OK, "Returning to Day Tracker…", target);
	}

	private static String encode(String value) {
		return URLEncoder.encode(value, StandardCharsets.UTF_8);
	}

	/**
	 * A page rather than a bare redirect, so a link stays on screen if the browser
	 * does not follow the automatic one.
	 */
	private static ResponseEntity<String> page(HttpStatus status, String message, String target) {
		String escaped = target == null ? null : HtmlUtils.htmlEscape(target);
		String html = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Day Tracker</title>"
				+ (escaped == null ? "" : "<meta http-equiv=\"refresh\" content=\"0;url=" + escaped + "\">")
				+ "<body style=\"font-family:Segoe UI,sans-serif;background:#20242c;color:#edf0f5;"
				+ "display:grid;place-items:center;height:100vh;margin:0\"><p>" + HtmlUtils.htmlEscape(message)
				+ (escaped == null ? ""
						: " <a style=\"color:#8aa7f0\" href=\"" + escaped + "\">Continue</a>")
				+ "</p></body></html>";
		return ResponseEntity.status(status)
			.contentType(new MediaType("text", "html", StandardCharsets.UTF_8))
			.cacheControl(CacheControl.noStore())
			.header("Referrer-Policy", "no-referrer")
			.header("X-Content-Type-Options", "nosniff")
			.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
			.body(html);
	}

}
