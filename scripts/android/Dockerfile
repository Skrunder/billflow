# Build environment for the Android app: JDK 21 + Android SDK.
# Used by scripts/build-apk.sh; nothing from this image ships in the APK.
#
# Building this image accepts the Android SDK license terms on your behalf
# (https://developer.android.com/studio/terms).
FROM eclipse-temurin:21.0.8_9-jdk-noble

ARG CMDLINE_TOOLS=commandlinetools-linux-13114758_latest.zip
ARG CMDLINE_TOOLS_SHA256=7ec965280a073311c339e571cd5de778b9975026cfcbe79f2b1cdcb1e15317ee

ENV ANDROID_HOME=/opt/android-sdk \
    GRADLE_USER_HOME=/cache/gradle \
    ANDROID_USER_HOME=/cache/android
ENV PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends unzip \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p $ANDROID_HOME/cmdline-tools \
 && curl -fsSLo /tmp/clt.zip https://dl.google.com/android/repository/$CMDLINE_TOOLS \
 && echo "$CMDLINE_TOOLS_SHA256  /tmp/clt.zip" | sha256sum -c - \
 && unzip -q /tmp/clt.zip -d /tmp/clt && mv /tmp/clt/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
 && rm -rf /tmp/clt /tmp/clt.zip \
 && yes | sdkmanager --licenses >/dev/null \
 && sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;35.0.0" >/dev/null \
 && mkdir -p /cache/gradle /cache/android && chmod -R 1777 /cache

WORKDIR /src
