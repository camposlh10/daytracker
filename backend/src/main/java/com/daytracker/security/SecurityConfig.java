package com.daytracker.security;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import jakarta.servlet.DispatcherType;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;

import com.daytracker.config.AppProperties;

/**
 * Stateless API protected by the per-launch bearer token. There are no users,
 * passwords, sessions, or cookies; requests come from the Electron main process.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

	@Bean
	SecurityFilterChain apiSecurity(HttpSecurity http, AppProperties properties) throws Exception {
		http.csrf(AbstractHttpConfigurer::disable)
			.cors(AbstractHttpConfigurer::disable)
			.httpBasic(AbstractHttpConfigurer::disable)
			.formLogin(AbstractHttpConfigurer::disable)
			.logout(AbstractHttpConfigurer::disable)
			.requestCache(AbstractHttpConfigurer::disable)
			.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
			.authorizeHttpRequests(requests -> requests.dispatcherTypeMatchers(DispatcherType.ERROR)
				.permitAll()
				// Reached by the user's browser, not the app: see SpotifyRelayController.
				.requestMatchers(HttpMethod.GET, "/spotify/callback")
				.permitAll()
				.anyRequest()
				.authenticated())
			.exceptionHandling(handling -> handling.authenticationEntryPoint(unauthorizedEntryPoint()))
			.addFilterBefore(new LaunchTokenFilter(properties.launchToken()), AnonymousAuthenticationFilter.class);
		return http.build();
	}

	// Present only so Spring Boot does not create a default user with a generated password.
	@Bean
	UserDetailsService noUsers() {
		return username -> {
			throw new UsernameNotFoundException("This application has no user accounts.");
		};
	}

	private static AuthenticationEntryPoint unauthorizedEntryPoint() {
		return (request, response, exception) -> {
			response.setStatus(HttpStatus.UNAUTHORIZED.value());
			response.setContentType(MediaType.APPLICATION_JSON_VALUE);
			response.setCharacterEncoding(StandardCharsets.UTF_8.name());
			response.getWriter()
				.write("{\"code\":\"UNAUTHORIZED\",\"message\":\"Missing or invalid launch credentials.\","
						+ "\"correlationId\":\"" + UUID.randomUUID() + "\"}");
		};
	}

}
