import { z } from "zod";

const DOMAIN_RE = /^[a-zA-Z0-9.-]+$/;

const DomainSchema = z
  .string()
  .min(1, "domain cannot be empty")
  .regex(DOMAIN_RE, "domain contains unsupported characters");

const PortSchema = z.number().int().min(1).max(65535);

export const ProfileSchema = z.object({
  openclaw: z.object({
    webui: z
      .object({
        enabled: z.boolean().default(false)
      })
      .default({}),
    gateway: z
      .object({
        public_listen: z.boolean().default(false),
        allow_unconfigured: z.boolean().default(true)
      })
      .default({}),
    approvals: z.object({
      exec: z.enum(["allow", "require", "deny"])
    })
  }),
  snapper: z
    .object({
      enabled: z.boolean().default(false)
    })
    .default({}),
  network: z
    .object({
      egress_default: z.enum(["deny", "allow"]).default("deny"),
      allow: z.array(DomainSchema).default([]),
      allow_ports: z.array(PortSchema).default([])
    })
    .default({})
});

export type ProfileConfig = z.infer<typeof ProfileSchema>;
