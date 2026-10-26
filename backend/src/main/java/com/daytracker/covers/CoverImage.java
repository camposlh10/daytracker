package com.daytracker.covers;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

import com.daytracker.common.ApiExceptions.InvalidInputException;

/**
 * Validated image bytes. The type is decided from the file signature, never from
 * a file name or a remote Content-Type header, and only still images the
 * renderer can show safely are accepted.
 */
public record CoverImage(byte[] data, String contentType) {

	/** 2 MiB, enough for a large book cover. */
	public static final int MAX_BYTES = 2 * 1024 * 1024;

	public static CoverImage of(byte[] data, String field) {
		if (data == null || data.length == 0) {
			throw new InvalidInputException(field, "The image is empty.");
		}
		if (data.length > MAX_BYTES) {
			throw new InvalidInputException(field, "The image is larger than 2 MB.");
		}
		String type = sniff(data);
		if (type == null) {
			throw new InvalidInputException(field, "Only JPEG, PNG, or WebP images can be used as covers.");
		}
		return new CoverImage(data, type);
	}

	static String sniff(byte[] data) {
		if (data.length >= 3 && (data[0] & 0xFF) == 0xFF && (data[1] & 0xFF) == 0xD8 && (data[2] & 0xFF) == 0xFF) {
			return "image/jpeg";
		}
		if (data.length >= 8 && (data[0] & 0xFF) == 0x89 && data[1] == 'P' && data[2] == 'N' && data[3] == 'G'
				&& data[4] == 0x0D && data[5] == 0x0A && data[6] == 0x1A && data[7] == 0x0A) {
			return "image/png";
		}
		if (data.length >= 12 && data[0] == 'R' && data[1] == 'I' && data[2] == 'F' && data[3] == 'F' && data[8] == 'W'
				&& data[9] == 'E' && data[10] == 'B' && data[11] == 'P') {
			return "image/webp";
		}
		return null;
	}

	public String sha256() {
		try {
			return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException(ex);
		}
	}

}
