package com.daytracker.database;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

/**
 * One ordered SQL script, named {@code V001__description.sql}.
 */
public record MigrationScript(int version, String description, String sql) {

	private static final Pattern FILE_NAME = Pattern.compile("V(\\d+)__(.+)\\.sql");

	public static MigrationScript fromFile(String fileName, String content) {
		Matcher matcher = FILE_NAME.matcher(fileName);
		if (!matcher.matches()) {
			throw new MigrationException("Migration file name does not match V###__description.sql: " + fileName);
		}
		// Line endings are normalized so a checkout with CRLF keeps the same checksum.
		String normalized = content.replace("\r\n", "\n").replace('\r', '\n');
		return new MigrationScript(Integer.parseInt(matcher.group(1)), matcher.group(2).replace('_', ' '), normalized);
	}

	public static List<MigrationScript> loadAll(String locationPattern) {
		try {
			List<MigrationScript> scripts = new ArrayList<>();
			for (Resource resource : new PathMatchingResourcePatternResolver().getResources(locationPattern)) {
				scripts.add(fromFile(resource.getFilename(), resource.getContentAsString(StandardCharsets.UTF_8)));
			}
			scripts.sort(Comparator.comparingInt(MigrationScript::version));
			return scripts;
		}
		catch (IOException ex) {
			throw new MigrationException("Cannot read migration scripts from " + locationPattern, ex);
		}
	}

	public String checksum() {
		try {
			MessageDigest digest = MessageDigest.getInstance("SHA-256");
			return HexFormat.of().formatHex(digest.digest(sql.getBytes(StandardCharsets.UTF_8)));
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException(ex);
		}
	}

	/**
	 * Splits on statement-ending semicolons after removing {@code --} comments.
	 * Scripts must not contain semicolons inside string literals or trigger bodies;
	 * such a migration needs a separately documented procedure.
	 */
	public List<String> statements() {
		StringBuilder withoutComments = new StringBuilder();
		for (String line : sql.split("\n")) {
			int comment = line.indexOf("--");
			withoutComments.append(comment >= 0 ? line.substring(0, comment) : line).append('\n');
		}
		List<String> statements = new ArrayList<>();
		for (String statement : withoutComments.toString().split(";")) {
			if (!statement.isBlank()) {
				statements.add(statement.strip());
			}
		}
		return statements;
	}

}
