import { z } from "zod";

import { emailSchema } from "./auth";

export const tenantRoleSchema = z.enum(["OWNER", "ACCOUNTANT", "STAFF"]);

export const inviteUserSchema = z.object({
  name: z.string().trim().min(2, "Enter the person's name").max(100),
  email: emailSchema,
  role: tenantRoleSchema,
});

export const changeRoleSchema = z.object({
  userId: z.string().min(1),
  role: tenantRoleSchema,
});

export const userIdSchema = z.object({ userId: z.string().min(1) });
