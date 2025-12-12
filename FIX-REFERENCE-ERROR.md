# Fix ReferenceError: Cannot access 'E' before initialization

## Problem
The user reported a `ReferenceError: Cannot access 'E' before initialization` in the browser console. The stack trace pointed to `index-M3458QqR.js` (minified code) and mentioned `[DesktopNotification]` and `[VoiceNotification]`.

## Analysis
The error was caused by incorrect usage of `DesktopNotification` and `SoundNotification` in `frontend/src/components/TaskComments.jsx` and `frontend/src/components/TaskComments-modern.jsx`.

These files were importing the default export from `frontend/src/utils/desktopNotification.js` and `frontend/src/utils/soundNotification.js`.
The default export in these utility files is an **instance** of the class, not the class itself.

However, the components were trying to instantiate the imported value using `new`:
```javascript
import DesktopNotification from '@/utils/desktopNotification';
// ...
new DesktopNotification(); // Error: DesktopNotification is an object, not a constructor
```

This likely caused the `ReferenceError` (or a `TypeError` that looked like one in the minified build) because the variable `DesktopNotification` (holding the instance) might have been accessed in a way that triggered a Temporal Dead Zone issue or simply failed during execution.

## Solution
1.  Updated `frontend/src/components/TaskComments-modern.jsx` and `frontend/src/components/TaskComments.jsx` to import the instances directly using lowercase names (convention).
2.  Removed the `useRef` logic that was trying to lazily instantiate the classes.
3.  Updated the code to use the imported instances directly.

## Files Changed
-   `frontend/src/components/TaskComments-modern.jsx`
-   `frontend/src/components/TaskComments.jsx`

## Verification
-   Checked for other occurrences of `new DesktopNotification()` and `new SoundNotification()` in the codebase. None found except in the definition files.
-   Verified that `frontend/src/components/OrderWorkView.jsx` and `frontend/src/components/TaskDashboard.jsx` were already using the correct named imports and usage patterns.
