@echo off
REM ============================================================
REM  다무스 반자동 라이브 러너 + 대시보드
REM  모드는 .env 로 결정: PAPER / BINANCE_TESTNET / LIVE_CONFIRM
REM  실행 전 기존 러너를 정리해 상태파일 충돌을 막는다.
REM ============================================================
cd /d %~dp0
set PYTHONUTF8=1

echo [1/3] 기존 러너 정리...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*run_live_semi.py*' -or $_.CommandLine -like '*run_paper.py*' } | ForEach-Object { Write-Host ('  종료 pid ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force }"

echo [2/3] 러너 시작...
start "damus-live" /min python -X utf8 -u run_live_semi.py

echo [3/3] 대시보드 시작...
powershell -NoProfile -Command "if (Test-Path frontend\dev.log) { $c = Get-Content frontend\dev.log -Tail 5 -ErrorAction SilentlyContinue }"
cd frontend
start "damus-desk" /min cmd /c "npm run dev > dev.log 2>&1"
cd ..

echo.
echo   대시보드 : http://localhost:3100
echo   러너 로그 : output\live\live.log
echo   모드     : .env 의 PAPER / BINANCE_TESTNET 확인
echo.
echo   중지하려면 stop_live.bat 실행
pause
