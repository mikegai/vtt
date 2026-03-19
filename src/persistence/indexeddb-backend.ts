import type { CanonicalState } from '../domain/types'
import type { PersistenceBackend, PersistedLocalState } from './backend'

const DB_NAME = 'acks-vtt'
const DB_VERSION = 1
const STORE_NAME = 'state'
const WORLD_KEY = 'worldState'
const LOCAL_KEY = 'localState'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(key)
    request.onsuccess = () => resolve((request.result as T) ?? null)
    request.onerror = () => reject(request.error)
  })
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.put(value, key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

function idbClear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.clear()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

export class IndexedDBBackend implements PersistenceBackend {
  private dbPromise: Promise<IDBDatabase> | null = null

  private getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB()
    }
    return this.dbPromise
  }

  async loadWorldState(): Promise<CanonicalState | null> {
    const db = await this.getDB()
    return idbGet<CanonicalState>(db, WORLD_KEY)
  }

  async saveWorldState(state: CanonicalState): Promise<void> {
    const db = await this.getDB()
    await idbPut(db, WORLD_KEY, state)
  }

  async loadLocalState(): Promise<Partial<PersistedLocalState> | null> {
    const db = await this.getDB()
    return idbGet<Partial<PersistedLocalState>>(db, LOCAL_KEY)
  }

  async saveLocalState(state: PersistedLocalState): Promise<void> {
    const db = await this.getDB()
    await idbPut(db, LOCAL_KEY, state)
  }

  async clear(): Promise<void> {
    const db = await this.getDB()
    await idbClear(db)
  }
}
