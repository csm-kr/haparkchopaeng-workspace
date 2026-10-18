# PT 내보내기 폰트

Pretendard v1.3.9의 Regular·SemiBold TTF를 HTML/PDF의 같은 좌표·폰트 측정에 사용한다. 외부 CDN이나 OS의 한글 폰트 설치 없이 출력한다.

- 원본: https://github.com/orioncactus/pretendard/tree/v1.3.9/packages/pretendard/dist/public/static/alternative
- 라이선스: 같은 폴더의 `Pretendard-LICENSE.txt` (SIL Open Font License 1.1)
- Regular SHA-256: `6d0af5258997aec7354a6e340fc2325ba321c410ca48b3af858c8c3d6e92a324`
- SemiBold SHA-256: `5e1c548732af70873103066c16e1369b9a8a871f0b38c321a1d5bc73e43cea2d`

`@pdf-lib/fontkit` 1.1.1의 이 폰트 subset 출력에서 MuPDF의 invalid glyph 경고를 확인했다. PDF에는 전체 폰트를 포함한다. 파일이 커지지만 한글 글리프와 원문 복사를 보존한다. HTML에도 같은 폰트를 포함한다.
