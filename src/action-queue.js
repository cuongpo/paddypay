const daysWithoutReadings = (water = [], seasonDays = 100) => {
  const recorded = new Set(water.map(reading => reading.day));
  return Array.from({ length: seasonDays }, (_, index) => index + 1).filter(day => !recorded.has(day));
};

function classify(reason, missingDays) {
  let match = /^Missing photo for day (\d+)$/.exec(reason);
  if (match) return {
    kind: 'missing-photo', day: Number(match[1]), title: `Missing day ${match[1]} photo`,
    nextStep: `Find the water-tube photo taken on day ${match[1]} and submit it with its measured level. A new photo cannot recreate an earlier observation.`,
  };
  match = /^Sensor data missing for (\d+) days$/.exec(reason);
  if (match) return {
    kind: 'sensor-gap', day: missingDays[0] ?? null, title: `${match[1]}-day sensor gap`,
    nextStep: 'Check the cluster sensor and record a follow-up water-tube photo. The photo documents the field; it does not replace missing signed readings.',
  };
  match = /^Day (\d+) photo: water level too low$/.exec(reason);
  if (match) return {
    kind: 'unsafe-depth', day: Number(match[1]), title: `Day ${match[1]} water level too low`,
    nextStep: 'Review the original photo and field reading. Record a follow-up observation if the measurement was entered incorrectly; keep the original evidence visible.',
  };
  match = /^Day (\d+) photo conflicts with the cluster sensor$/.exec(reason);
  if (match) return {
    kind: 'photo-conflict', day: Number(match[1]), title: `Day ${match[1]} photo conflicts with sensor`,
    nextStep: 'Compare the original image with the cluster sensor reading. Record a follow-up observation and flag the discrepancy for review.',
  };
  return { kind: 'review', day: null, title: reason, nextStep: 'Review this plot with the cooperative and record supporting field evidence.' };
}

export function actionQueue(plots, photos, waterByCluster = {}, readOnly = false) {
  const actions = [];
  for (const plot of plots) {
    for (const photo of photos.filter(item => item.plotCode === plot.code && item.aiReview)) {
      const review = photo.aiReview;
      const disagreesWithHuman = Number.isInteger(review.ai?.suggestedCm) && Math.abs(review.ai.suggestedCm - photo.confirmedCm) > 10;
      if (review.recommendation === 'human_confirmation' && !disagreesWithHuman) continue;
      actions.push({
        id: `${plot.code}:ai-photo-review:${photo.day}:${photo.imageHash}`,
        plotCode: plot.code, cluster: plot.cluster, severity: 'yellow',
        reason: 'AI photo screen requires a cooperative check', kind: 'ai-photo-review', day: photo.day,
        title: `Day ${photo.day} AI photo review`,
        nextStep: 'Compare the uploaded image, human-confirmed level, and shared cluster sensor. The AI suggestion alone cannot authenticate the photo or decide eligibility.',
        missingDays: [], state: 'open', followupHash: photo.imageHash, canAddEvidence: false,
      });
    }
    const status = plot.score?.status ?? plot.status;
    if (status === 'green') continue;
    const reasons = plot.score?.reasons ?? plot.reasons ?? [];
    const missingDays = daysWithoutReadings(waterByCluster[plot.cluster]);
    for (const reason of reasons) {
      const issue = classify(reason, missingDays);
      const relevantDays = issue.kind === 'sensor-gap' ? missingDays : [issue.day];
      const followup = photos.findLast(photo => photo.plotCode === plot.code && photo.source === 'user-confirmed' && relevantDays.includes(photo.day));
      actions.push({
        id: `${plot.code}:${issue.kind}:${issue.day ?? 0}`,
        plotCode: plot.code, cluster: plot.cluster, severity: status,
        reason, ...issue, missingDays: issue.kind === 'sensor-gap' ? missingDays : [],
        state: followup ? 'evidence-added' : 'open',
        followupHash: followup?.imageHash ?? null,
        canAddEvidence: !readOnly && !plot.finalizeTx,
      });
    }
  }
  actions.sort((a, b) => Number(b.severity === 'red') - Number(a.severity === 'red') || a.plotCode.localeCompare(b.plotCode) || Number(b.kind === 'missing-photo') - Number(a.kind === 'missing-photo') || a.title.localeCompare(b.title));
  return actions;
}

export function sampleWaterByCluster(state) {
  const water = {};
  for (const cluster of new Set(state.plots.map(plot => plot.cluster))) {
    const sample = state.plots.find(plot => plot.cluster === cluster);
    water[cluster] = state.readings.filter(reading => reading.plotId === sample.plotId && reading.seq % 3 === 1)
      .map(reading => ({ day: reading.day, cm: reading.waterLevelCm }));
  }
  return water;
}
