package com.daytracker.database;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;

import javax.sql.DataSource;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.sqlite.SQLiteConfig;
import org.sqlite.SQLiteDataSource;

import com.daytracker.config.AppProperties;

@Configuration
public class DatabaseConfig {

	static final String MIGRATION_LOCATION = "classpath:db/migration/V*__*.sql";

	private static final int BUSY_TIMEOUT_MS = 5_000;

	private static final int POOL_SIZE = 4;

	@Bean(destroyMethod = "close")
	HikariDataSource dataSource(AppProperties properties) {
		return createDataSource(properties.databaseFile());
	}

	// Runs as part of context startup, so the schema is current before the
	// web server accepts requests and before readiness is announced.
	@Bean(initMethod = "migrate")
	MigrationRunner migrationRunner(DataSource dataSource, AppProperties properties, Clock clock) {
		return new MigrationRunner(dataSource, properties.backupsDir(), clock,
				MigrationScript.loadAll(MIGRATION_LOCATION));
	}

	/**
	 * Every pooled connection enforces foreign keys, uses WAL with a bounded busy
	 * timeout, and begins transactions with BEGIN IMMEDIATE so writers are
	 * serialized instead of failing on a lock upgrade.
	 */
	public static HikariDataSource createDataSource(Path databaseFile) {
		try {
			Files.createDirectories(databaseFile.toAbsolutePath().getParent());
		}
		catch (IOException ex) {
			throw new UncheckedIOException("Cannot create the database directory.", ex);
		}
		SQLiteConfig sqliteConfig = new SQLiteConfig();
		sqliteConfig.enforceForeignKeys(true);
		sqliteConfig.setJournalMode(SQLiteConfig.JournalMode.WAL);
		sqliteConfig.setBusyTimeout(BUSY_TIMEOUT_MS);
		sqliteConfig.setTransactionMode(SQLiteConfig.TransactionMode.IMMEDIATE);
		SQLiteDataSource sqlite = new SQLiteDataSource(sqliteConfig);
		sqlite.setUrl("jdbc:sqlite:" + databaseFile.toAbsolutePath());

		HikariConfig pool = new HikariConfig();
		pool.setPoolName("daytracker-sqlite");
		pool.setDataSource(sqlite);
		pool.setMaximumPoolSize(POOL_SIZE);
		return new HikariDataSource(pool);
	}

}
