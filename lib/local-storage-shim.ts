type LocalStorageLike = {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
  clear?: () => void;
  key?: (index: number) => string | null;
  length?: number;
};

const globalObject = globalThis as typeof globalThis & {
  localStorage?: LocalStorageLike;
  window?: {
    localStorage?: LocalStorageLike;
  };
};

function createMemoryStorage(): Required<LocalStorageLike> {
  const memoryStore = new Map<string, string>();

  return {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryStore.set(key, value);
    },
    removeItem: (key: string) => {
      memoryStore.delete(key);
    },
    clear: () => {
      memoryStore.clear();
    },
    key: (index: number) => Array.from(memoryStore.keys())[index] ?? null,
    get length() {
      return memoryStore.size;
    },
  };
}

function installStorageShim() {
  const storage = createMemoryStorage();

  try {
    Object.defineProperty(globalObject, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  } catch {
    globalObject.localStorage = storage;
  }

  if (globalObject.window) {
    try {
      Object.defineProperty(globalObject.window, "localStorage", {
        value: storage,
        configurable: true,
        writable: true,
      });
    } catch {
      globalObject.window.localStorage = storage;
    }
  }
}

const storage = globalObject.localStorage;

if (storage && typeof storage.getItem !== "function") {
  installStorageShim();
}
