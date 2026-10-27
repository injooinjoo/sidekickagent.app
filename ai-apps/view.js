// Shared rendering for the authenticated fallback page and the MCP Apps card.
// All content is text; stored model output never becomes executable HTML.
export function renderCard(root, data, actions = {}) {
  root.replaceChildren();
  const el = (tag, text) => { const n = document.createElement(tag); n.textContent = text || ''; return n; };
  const button = (label, action) => {
    const n = el('button', label); n.type = 'button';
    n.addEventListener('click', async () => {
      n.disabled = true;
      try { await action(); } catch { notice.textContent = '처리하지 못했어요. 최신 상태를 다시 확인해 주세요.'; }
      finally { n.disabled = false; }
    });
    return n;
  };
  const notice = el('p'); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  const heading = el('h2', data.preparation_id ? '일과 준비' : data.status === 'succeeded' ? '일과 결과' : '일과 진행');
  const statuses = { awaiting_approval: '확인 필요', ready: '시작할 수 있어요', awaiting_input: '연결한 AI와 이어서 진행', running: '제작 중', succeeded: '완료', failed: '확인 필요', cancel_requested: '중단 확인 중', cancelled: '중단됨' };
  root.append(heading, el('p', statuses[data.status] || data.status), el('p', data.summary));
  const steps = data.workflow?.steps || data.steps || [];
  const list = el('ol');
  for (const step of steps) {
    const item = el('li');
    const labels = { completed: '완료', pending: '대기', awaiting_approval: '확인 필요', queued: '접수됨', running: '제작 중', ready: '단계 결과 확인', failed: '제작 확인 필요', cancelled: '중단됨', awaiting_input: '상태 확인 중' };
    item.append(el('strong', step.title), el('span', ' · ' + (labels[step.status] || (step.kind === 'host' ? '연결한 AI가 수행' : '서비스 연결로 수행'))), el('p', step.instruction));
    if (step.id === data.workflow?.current_step_id) item.setAttribute('aria-current', 'step');
    list.append(item);
  }
  root.append(list);
  // Owner rule 2026-10-27: never a credit amount; a share of this period's usage when known, else words only.
  const share = usageLine(data.usage);
  root.append(el('p', share || data.usage?.explanation || ''));
  if (data.updated_at) { const time = el('time', '갱신: ' + data.updated_at); time.dateTime = data.updated_at; root.append(time); }
  if (data.workflow?.continuation && !['succeeded', 'failed', 'cancelled'].includes(data.status)) root.append(el('p', data.workflow.continuation));
  const required = data.workflow?.required_action || data.required_action;
  if (required?.message) root.append(el('p', required.message));
  if (required?.url && actions.open) root.append(button(required.type === 'connect_service' ? '필요한 서비스 연결' : 'Sidekick에서 확인', () => actions.open(required.url)));
  if (data.preparation_id && actions.start) root.append(button('확인한 조건으로 일과 시작', () => actions.start(data)));
  if (actions.refresh) root.append(button('상태 갱신', actions.refresh));
  if (data.job_id && !['succeeded', 'failed', 'cancelled'].includes(data.status) && actions.cancel) root.append(button('중단 요청', () => actions.cancel(data)));
  for (const asset of data.artifacts || []) {
    const row = el('section'); row.append(el('h3', asset.title || asset.name || '결과물'));
    const url = safeHttps(asset.url);
    if (url) {
      if (asset.mime_type?.startsWith('video/') || asset.mime_type?.startsWith('audio/')) {
        const media = el(asset.mime_type.startsWith('video/') ? 'video' : 'audio'); media.controls = true; media.preload = 'none'; media.src = url;
        media.addEventListener('error', () => { notice.textContent = '미리보기를 열지 못했어요. 링크를 열거나 상태를 갱신해 주세요.'; }); row.append(media);
      }
      row.append(button('결과물 열기·다운로드', () => actions.open?.(url)));
    }
    root.append(row);
  }
  if (data.result_text) root.append(el('pre', data.result_text));
  if (data.result_version) {
    root.append(el('p', '결과 버전: ' + data.result_version.slice(0, 12)));
    if (actions.revise) {
      const label = el('label', '수정할 내용'); label.htmlFor = 'revision-request';
      const input = el('textarea'); input.id = 'revision-request'; input.maxLength = 4000;
      root.append(label, input, button('연결한 AI에게 수정 요청', () => actions.revise(data, input.value)));
    }
  }
  if (data.links?.web_url && actions.open) root.append(button('Sidekick에서 열기', () => actions.open(data.links.web_url)));
  root.append(notice);
}

export function usageLine(usage) {
  if (!usage) return '';
  for (const [key, label] of [['consumed_percent', '확인된 사용량'], ['reserved_percent', '예약된 사용량'], ['estimated_percent', '예상 사용량']]) {
    if (Number.isFinite(usage[key])) return `${label}: 이번 기간 사용량의 ${usage[key]}%`;
  }
  return '';
}

export function safeHttps(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; }
}
