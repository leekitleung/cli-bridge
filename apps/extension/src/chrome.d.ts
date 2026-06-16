// Minimal Chrome extension API type declarations for CLI Bridge.
// Only declares the subset actually used by this extension.

declare namespace chrome {
  namespace storage {
    interface StorageArea {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
    const local: StorageArea;
  }

  namespace runtime {
    interface MessageSender {
      tab?: { id?: number };
      id?: string;
    }

    type MessageListener = (
      message: unknown,
      sender: MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => boolean | void;

    interface OnMessageEvent {
      addListener(callback: MessageListener): void;
    }

    const onMessage: OnMessageEvent;
    const lastError: { message?: string } | undefined;
    function sendMessage(
      message: unknown,
      responseCallback?: (response: unknown) => void,
    ): void;
  }
}
