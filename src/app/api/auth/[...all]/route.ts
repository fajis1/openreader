import { auth } from "@/lib/server/auth/auth"; // path to your auth file
import { toNextJsHandler } from "better-auth/next-js";

const handlers = toNextJsHandler(auth);

export const { POST, GET } = handlers;
