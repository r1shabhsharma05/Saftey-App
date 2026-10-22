// App-wide styled dialogs.
//
// Alert.alert renders the OS-default grey dialog — off-brand, and on
// some devices easy to miss. showAppDialog has the same call shape
// (title, message, buttons) but renders the themed AppDialogHost that
// the root layout mounts once. Calls made before the host mounts are
// dropped (the host mounts with the root layout, before any screen
// can ask).

export interface AppDialogButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void | Promise<void>;
}

export interface AppDialogRequest {
  title: string;
  message?: string;
  buttons?: AppDialogButton[];
}

type Listener = (req: AppDialogRequest) => void;
let listener: Listener | null = null;

export function showAppDialog(title: string, message?: string, buttons?: AppDialogButton[]): void {
  if (listener) listener({ title, message, buttons });
}

export function registerDialogHost(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}
