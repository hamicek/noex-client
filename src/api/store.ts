import type { SendFn } from '../types.js';
import { BucketAPI } from './bucket.js';

export class StoreAPI {
  constructor(private readonly send: SendFn) {}

  bucket(name: string): BucketAPI {
    return new BucketAPI(name, this.send);
  }
}
