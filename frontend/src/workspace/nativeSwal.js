import Swal from 'sweetalert2/dist/sweetalert2.js';
import { getNativeRuntime, isNativeSessionCurrent, registerNativeCleanup } from './nativeRuntime.js';

// Use SweetAlert's public subclass, target and lifecycle APIs. withReactContent
// and mixin can continue extending this class without changing prompt semantics.
class WorkspaceSwal extends Swal {
    static fire(...args) {
        const runtime = getNativeRuntime();
        if (!runtime) return super.fire(...args);
        if (!isNativeSessionCurrent(runtime)) return Promise.resolve({ isDismissed: true });
        const removeCleanup = registerNativeCleanup(() => {
            if (this.getContainer()?.parentNode === runtime.portalTarget) {
                this.close();
            }
        }, runtime);
        try {
            return super.fire({ ...this.argsToParams(args), target: runtime.portalTarget, heightAuto: false, scrollbarPadding: false,
                hideClass: { popup: '', backdrop: '', icon: '' }, returnFocus: false })
                .then(result => isNativeSessionCurrent(runtime) ? result : { isDismissed: true })
                .finally(removeCleanup);
        } catch (error) {
            removeCleanup();
            throw error;
        }
    }
}

export default WorkspaceSwal;
