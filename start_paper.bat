@echo off
REM 페이퍼 러너 + 제어실 재시작 (PC 재부팅 후 등). 상태는 output\paper\state.json 에서 복원됨.
cd /d %~dp0
set PYTHONUTF8=1
start "damus-paper" /min python -X utf8 -u run_paper.py
cd frontend
start "damus-desk" /min cmd /c "npm run dev > dev.log 2>&1"
echo 페이퍼 러너와 제어실(http://localhost:3100)을 시작했습니다.
