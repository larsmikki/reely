@echo off
setlocal
REM Builds the Fetchr Android app end to end and drops the APK into data\
REM where the server offers it for download (Settings -> Android App).
cd /d "%~dp0"

echo [1/5] Building web client...
call npm run build -w client
if errorlevel 1 goto :fail

echo [2/5] Generating launcher icons and splash screens...
cd client
call npx @capacitor/assets generate --android
if errorlevel 1 goto :fail

echo [3/5] Syncing Capacitor Android project...
call npx cap sync android
if errorlevel 1 goto :fail
cd ..

echo [4/5] Building APK (gradle assembleDebug)...
cd client\android
call .\gradlew.bat assembleDebug
if errorlevel 1 goto :fail
cd ..\..

echo [5/5] Publishing APK to apk\ (picked up by the Docker build)...
if not exist apk mkdir apk
copy /Y "client\android\app\build\outputs\apk\debug\fetchr-client.apk" "apk\fetchr-client.apk" >nul
if errorlevel 1 goto :fail

echo.
echo Done. Deploy the Docker image as usual - the APK ships inside it and is
echo downloadable from the Settings page.
exit /b 0

:fail
echo.
echo BUILD FAILED
exit /b 1
