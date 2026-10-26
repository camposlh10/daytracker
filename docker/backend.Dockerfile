# Reproducible Java 21 / Maven environment that runs the backend tests and
# produces the executable JAR. Development and CI only; the installed app does
# not use Docker. Tests create their own temporary SQLite databases inside the
# container; never mount real application data into it.
#
#   docker build -f docker/backend.Dockerfile -t day-tracker-backend-build .
#   docker build -f docker/backend.Dockerfile --output type=local,dest=backend/target/docker .

FROM maven:3.9.16-eclipse-temurin-21@sha256:99e61abcff91a9b1333463bd8451fb18495d6eba9250ac66a338b518f8278320 AS build
WORKDIR /workspace/backend

# Resolve dependencies in their own layer so source changes do not re-download them.
COPY backend/pom.xml ./
RUN mvn -B -q -ntp dependency:go-offline

COPY backend/src ./src
RUN mvn -B -ntp verify

FROM scratch AS artifact
COPY --from=build /workspace/backend/target/day-tracker-backend.jar /day-tracker-backend.jar
