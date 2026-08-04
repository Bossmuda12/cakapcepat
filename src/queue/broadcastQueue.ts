import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config";

export const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

export interface BroadcastJobData {
  broadcastId: string;
}

export const broadcastQueue = new Queue<BroadcastJobData>("broadcast", { connection });

export async function enqueueBroadcast(broadcastId: string) {
  await broadcastQueue.add("send-broadcast", { broadcastId });
}
