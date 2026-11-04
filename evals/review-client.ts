// Served as a same-origin script by the local review server; no build step needed.
export const reviewClient = String.raw`
(() => {
  const byId = (id) => document.getElementById(id);
  const cards = Array.from(document.querySelectorAll('article[data-hash]'));
  const picker = byId('case-picker');
  const fields = byId('review-fields');
  const status = byId('save-status');
  const api = '/api/reviews/' + location.pathname.split('/')[1];
  let state, index = 0, dirty = false, saving = false, syncing = false;
  const showStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };
  const controls = () => {
    byId('previous').disabled = index === 0 || saving || syncing;
    byId('next').disabled = index === cards.length - 1 || saving || syncing;
    byId('save-next').disabled = index === cards.length - 1;
    picker.disabled = saving || syncing;
    byId('sync-braintrust').disabled = !state || dirty || saving || syncing;
  };
  function show(next) {
    if (!state || next < 0 || next >= cards.length) return;
    if (dirty && !window.confirm('Discard unsaved changes to this review?')) {
      picker.value = cards[index].id;
      return;
    }
    index = next;
    cards.forEach((card, number) => { card.hidden = number !== index; });
    const card = cards[index];
    const review = state.document.reviews.find((entry) => entry.case === card.id);
    if (review && review.output_sha256 !== card.dataset.hash) {
      fields.disabled = true;
      showStatus('Artwork changed since this review. Refresh the gallery before scoring.', true);
      return;
    }
    byId('reviewer').value = state.document.reviewer;
    byId('quality').value = review?.quality ?? '';
    byId('acceptable').value = review?.acceptable === null || review?.acceptable === undefined ? '' : String(review.acceptable);
    byId('notes').value = review?.notes ?? '';
    byId('skipped').checked = review?.skipped ?? false;
    document.querySelectorAll('[name=problem]').forEach((input) => { input.checked = review?.problems.includes(input.value) ?? false; });
    const skipped = byId('skipped').checked;
    byId('quality').disabled = skipped;
    byId('acceptable').disabled = skipped;
    picker.value = card.id;
    history.replaceState(null, '', '#' + card.id);
    const rated = state.document.reviews.filter((entry) => !entry.skipped && (entry.quality !== null || entry.acceptable !== null)).length;
    byId('progress').textContent = (index + 1) + ' / ' + cards.length + ' · ' + rated + ' rated';
    dirty = false;
    fields.disabled = false;
    showStatus(review && (review.quality !== null || review.acceptable !== null || review.notes || review.skipped) ? 'Loaded saved review.' : 'Not scored yet.');
    controls();
  }
  async function save(advance) {
    if (!state || saving || syncing) return;
    const card = cards[index];
    const skipped = byId('skipped').checked;
    const reviewer = byId('reviewer').value.trim();
    const quality = skipped || !byId('quality').value ? null : Number(byId('quality').value);
    const acceptable = skipped || !byId('acceptable').value ? null : byId('acceptable').value === 'true';
    if ((quality !== null || acceptable !== null) && !reviewer) {
      showStatus('Enter your name or initials before saving a score.', true);
      byId('reviewer').focus();
      return;
    }
    const previous = state.document.reviews.find((entry) => entry.case === card.id);
    const knownTags = Array.from(document.querySelectorAll('[name=problem]')).map((input) => input.value);
    const problems = Array.from(document.querySelectorAll('[name=problem]:checked')).map((input) => input.value);
    problems.push(...(previous?.problems ?? []).filter((tag) => !knownTags.includes(tag)));
    const payload = {
      revision: state.revision, reviewer,
      review: { case: card.id, output_sha256: card.dataset.hash, quality, acceptable, problems, notes: byId('notes').value, skipped }
    };
    saving = true; fields.disabled = true; controls(); showStatus('Saving…');
    try {
      const response = await fetch(api, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': document.querySelector('meta[name=review-token]').content },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Save failed.');
      state = result; dirty = false;
      byId('sync-status').textContent = 'Saved changes are ready to sync.';
      if (advance && index < cards.length - 1) show(index + 1);
      else { show(index); showStatus('Saved locally. Ready to sync to Braintrust.'); }
    } catch (error) {
      showStatus(error.message || 'Could not save. Your changes are still in the form.', true);
    } finally { saving = false; fields.disabled = false; controls(); }
  }
  byId('sync-braintrust').addEventListener('click', async () => {
    if (!state || saving || syncing || dirty) return;
    const syncStatus = byId('sync-status');
    syncing = true; fields.disabled = true; controls();
    byId('sync-braintrust').textContent = 'Syncing…';
    syncStatus.classList.remove('error');
    syncStatus.textContent = 'Uploading saved reviews and verifying scores…';
    try {
      const response = await fetch(api + '/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': document.querySelector('meta[name=review-token]').content },
        body: JSON.stringify({ revision: state.revision })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Sync failed. Try again.');
      syncStatus.textContent = 'Synced ' + result.count + ' outputs · ' + result.qualityRated + ' quality ratings · ' + result.acceptableRated + ' acceptability ratings. Missing scores remain N/A.';
    } catch (error) {
      syncStatus.classList.add('error');
      syncStatus.textContent = error.message || 'Sync failed. Your saved local reviews are safe; try again.';
    } finally {
      syncing = false; fields.disabled = false; controls();
      byId('sync-braintrust').textContent = 'Sync to Braintrust';
    }
  });
  byId('review-form').addEventListener('submit', (event) => { event.preventDefault(); save(false); });
  byId('save-next').addEventListener('click', () => save(true));
  byId('previous').addEventListener('click', () => show(index - 1));
  byId('next').addEventListener('click', () => show(index + 1));
  picker.addEventListener('change', () => show(cards.findIndex((card) => card.id === picker.value)));
  byId('review-form').addEventListener('input', () => { dirty = true; showStatus('Unsaved changes'); byId('sync-status').textContent = 'Save your changes before syncing.'; controls(); });
  byId('skipped').addEventListener('change', () => {
    const skipped = byId('skipped').checked;
    if (skipped) { byId('quality').value = ''; byId('acceptable').value = ''; }
    byId('quality').disabled = skipped; byId('acceptable').disabled = skipped;
  });
  window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  cards.forEach((card, number) => { card.hidden = number !== 0; });
  if (!cards.length) { showStatus('No completed artwork to review.'); return; }
  fetch(api).then(async (response) => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not load saved reviews.');
    state = result;
    const requested = cards.findIndex((card) => card.id === location.hash.slice(1));
    show(requested < 0 ? 0 : requested);
  }).catch((error) => showStatus(error.message || 'Start the local review server to score in this UI.', true));
})();
`;
