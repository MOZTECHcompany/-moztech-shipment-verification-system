// Keep the lock outside React state: scanner Enter events can arrive before the next render.
export function createScanSubmission() {
    let busy = false;
    let reviewRequired = false;
    return {
        isBusy: () => busy,
        requireReview: () => { reviewRequired = true; },
        submit(scanValue, operation) {
            if (busy || reviewRequired) {
                return { accepted: false, scanValue, reason: reviewRequired ? 'review' : 'busy' };
            }
            busy = true;
            const completion = Promise.resolve().then(() => operation(scanValue)).finally(() => { busy = false; });
            return { accepted: true, completion };
        }
    };
}
