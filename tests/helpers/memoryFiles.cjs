const crypto = require('node:crypto');

module.exports = function memoryFiles(data = new Map()) {
  const directories = new Set(), faults = {};
  const uriOf = parts => parts.map(part => (part.uri || part).replace(/\/$/, '')).join('/');
  class File {
    constructor(...parts) { this.uri = uriOf(parts); }
    get name() { return this.uri.split('/').pop(); }
    get exists() { return data.has(this.uri); }
    get size() { return data.get(this.uri)?.length || 0; }
    get md5() { return this.exists ? crypto.createHash('md5').update(data.get(this.uri)).digest('hex') : null; }
    open() {
      if (!this.exists) throw new Error('Open source missing');
      const bytes = data.get(this.uri);
      let closed = false, offset = 0;
      return {
        get offset() { return closed ? null : offset; },
        set offset(value) { offset = value; },
        readBytes(length) {
          if (closed) throw new Error('File handle is closed');
          const slice = bytes.subarray(offset, offset + length);
          offset += slice.length;
          return Uint8Array.from(slice);
        },
        close() { closed = true; },
      };
    }
    textSync() { if (!this.exists) throw new Error('Missing file'); return data.get(this.uri).toString(); }
    write(value) { if (faults.write) throw new Error('Write failed'); data.set(this.uri, Buffer.from(value)); }
    async copy(destination) {
      if (!this.exists) throw new Error('Copy source missing');
      const bytes = data.get(this.uri);
      data.set(destination.uri, Buffer.from(faults.partial ? bytes.subarray(0, 1) : bytes));
      if (faults.copyThrow) throw new Error('Copy interrupted');
      if (faults.copyWait) await faults.copyWait;
    }
    async move(destination, { overwrite } = {}) {
      if (faults.commit && (!faults.commitTarget || destination.uri === faults.commitTarget)) {
        if (faults.removeTargetBeforeFailure) data.delete(destination.uri);
        throw new Error('Commit failed');
      }
      if (!this.exists) throw new Error('Move source missing');
      if (destination.exists && !overwrite) throw new Error('Move would overwrite');
      data.set(destination.uri, data.get(this.uri)); data.delete(this.uri); this.uri = destination.uri;
      if (faults.afterCommit && destination.uri === faults.commitTarget) throw new Error('Move cleanup failed');
    }
    delete() { if (faults.delete) throw new Error('Delete failed'); data.delete(this.uri); }
  }
  class Directory {
    constructor(...parts) { this.uri = uriOf(parts); }
    get name() { return this.uri.split('/').pop(); }
    get exists() { return directories.has(this.uri) || [...data.keys()].some(uri => uri.startsWith(this.uri + '/')); }
    create() { directories.add(this.uri); }
    list() {
      const entries = new Map(), prefix = this.uri + '/';
      for (const uri of [...data.keys(), ...directories]) {
        if (!uri.startsWith(prefix)) continue;
        const [name, ...rest] = uri.slice(prefix.length).split('/');
        entries.set(name, rest.length || directories.has(uri) ? new Directory(prefix + name) : new File(uri));
      }
      return [...entries.values()];
    }
  }
  return { File, Directory, Paths: { document: { uri: 'file:///documents' }, cache: { uri: 'file:///cache/' } }, data, faults };
};
