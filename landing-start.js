/* The input is classified locally. Never send its text to a URL, storage or analytics. */
(function () {
  'use strict';
  var form = document.querySelector('.start-form'); if (!form) return;
  var field = document.getElementById('start-goal'), hint = document.getElementById('start-recommendation');
  var goals = [
    ['youtube','유튜브 시작하기',['유튜브','영상','채널','대본']],
    ['blog','블로그 시작하기',['블로그','네이버','워드프레스','글쓰기','글']],
    ['instagram','인스타 콘텐츠 만들기',['인스타','릴스','콘텐츠']],
    ['store-cs','스토어 문의 정리하기',['스토어','문의','고객','상담']],
    ['briefing','아침 브리핑 받기',['아침','브리핑','뉴스']],
    ['price-watch','가격 변동 지켜보기',['가격','시세']],
    ['real-estate','임장 자료 정리하기',['임장','부동산','아파트']],
    ['tax','경비 정리하기',['경비','세금','영수증']]
  ];
  function match() {
    var text = field.value.toLocaleLowerCase(), best = null, score = 0;
    goals.forEach(function (goal) { goal[2].forEach(function (word) { if (text.includes(word) && word.length > score) { score = word.length; best = goal; } }); });
    return best;
  }
  field.addEventListener('input',function () { var goal = match(); hint.textContent = goal ? '추천: ' + goal[1] : '아래에서 고르거나, 예시를 먼저 눌러보세요.'; });
  form.addEventListener('submit',function (event) {
    event.preventDefault(); var goal = match(), slug = goal ? goal[0] : 'unmatched';
    try { if (window.SidekickWebAnalytics) window.SidekickWebAnalytics.track('use_case_selected',{task_type:slug,source:'landing_closing'}); } catch (_) {}
    location.assign(goal ? '/use/' + goal[0] + '/' : '/demo/');
  });
})();
