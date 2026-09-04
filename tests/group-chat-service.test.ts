import { describe, expect, it, vi } from "vitest";
import { GroupChatService } from "../server/group-chat-service";

describe("GroupChatService", () => {
  it("loads the native Hermes group membership and mirrored room transcript", async () => {
    const gateway = {
      request: vi.fn().mockResolvedValue({
        profiles: [
          {
            name: "default",
            ui_meta: {
              "hermes-bots-groups": {
                version: 3,
                rooms: {
                  "name:Byfinity Core Team": {
                    name: "Byfinity Core Team",
                    revision: 4,
                    log: [
                      { id: "m1", from: { kind: "user", name: "You" }, text: "Faites le point", at: 1 },
                      { id: "m2", from: { kind: "member", name: "finance-byfinity" }, text: "Budget valide", at: 2 }
                    ]
                  }
                }
              }
            }
          },
          { name: "finance-byfinity", ui_meta: { "hermes-bots": { groups: ["Byfinity Core Team"] } } },
          { name: "ops-direction-byfinity", ui_meta: { "hermes-bots": { group: "Byfinity Core Team" } } }
        ]
      }),
      subscribe: vi.fn().mockReturnValue(() => undefined)
    };
    const service = new GroupChatService(gateway);

    await expect(service.listGroups()).resolves.toEqual([
      {
        id: "name:Byfinity Core Team",
        name: "Byfinity Core Team",
        members: ["finance-byfinity", "ops-direction-byfinity"],
        messages: [
          { id: "m1", author: "user", authorKind: "user", text: "Faites le point", at: 1 },
          { id: "m2", author: "finance-byfinity", authorKind: "bot", text: "Budget valide", at: 2 }
        ],
        running: false
      }
    ]);
  });

  it("lists a native membership-only Core Team even when the room log is empty", async () => {
    const gateway = {
      request: vi.fn().mockResolvedValue({
        profiles: [
          { name: "default", ui_meta: {} },
          { name: "finance-byfinity", ui_meta: { "hermes-bots": { groups: ["Byfinity Core Team"] } } },
          { name: "ops-direction-byfinity", ui_meta: { "hermes-bots": { groups: ["Byfinity Core Team"] } } },
          { name: "specs-byfinity", ui_meta: { "hermes-bots": { groups: ["Byfinity Core Team"] } } },
          { name: "lead-intel-byfinity", ui_meta: { "hermes-bots": { groups: ["Byfinity Core Team"] } } }
        ]
      }),
      subscribe: vi.fn().mockReturnValue(() => undefined)
    };
    const service = new GroupChatService(gateway);

    await expect(service.listGroups()).resolves.toEqual([
      {
        id: "name:Byfinity Core Team",
        name: "Byfinity Core Team",
        members: ["finance-byfinity", "ops-direction-byfinity", "specs-byfinity", "lead-intel-byfinity"],
        messages: [],
        running: false
      }
    ]);
  });

  it("creates a 2-to-6 Bot room using native membership and room projection", async () => {
    const gateway = {
      request: vi.fn(async (method: string) => {
        if (method === "profiles.list") return {
          profiles: [
            {
              name: "default",
              ui_meta: {
                "hermes-bots-groups": {
                  version: 3,
                  rooms: {
                    "name:Existing": { name: "Existing", revision: 7, log: [], members: [] }
                  }
                }
              },
              ui_meta_revisions: { "hermes-bots-groups": 4 }
            },
            { name: "finance", ui_meta: { "hermes-bots": { title: "Finance", avatar: "kept", groups: ["Existing"] } } },
            { name: "ops", ui_meta: { "hermes-bots": { title: "Ops", group: "Legacy" } } }
          ]
        };
        if (method === "profiles.configure") return { applied: { ui_meta: true, ui_meta_revisions: { "hermes-bots-groups": 5 } } };
        throw new Error(`unexpected ${method}`);
      }),
      subscribe: vi.fn().mockReturnValue(() => undefined)
    };
    const service = new GroupChatService(gateway, () => "room-2");

    await expect(service.createGroup("Direction", ["finance", "ops"])).resolves.toMatchObject({
      id: "room-2",
      name: "Direction",
      members: ["finance", "ops"],
      messages: [],
      running: false
    });
    expect(gateway.request).toHaveBeenCalledWith("profiles.configure", {
      name: "finance",
      ui_meta: {
        "hermes-bots": {
          title: "Finance",
          avatar: "kept",
          groups: ["Existing", "Direction"],
          group: "Existing"
        }
      }
    });
    expect(gateway.request).toHaveBeenCalledWith("profiles.configure", {
      name: "ops",
      ui_meta: {
        "hermes-bots": {
          title: "Ops",
          groups: ["Legacy", "Direction"],
          group: "Legacy"
        }
      }
    });
    expect(gateway.request).toHaveBeenCalledWith("profiles.configure", expect.objectContaining({
      name: "default",
      ui_meta: expect.objectContaining({
        "hermes-bots-groups": expect.objectContaining({
          version: 3,
          rooms: expect.objectContaining({
            "name:Existing": expect.any(Object),
            "id:room-2": expect.objectContaining({
              name: "Direction",
              roomId: "room-2",
              revision: 5,
              log: [],
              members: [{ name: "finance" }, { name: "ops" }]
            })
          })
        })
      }),
      ui_meta_expected_revisions: { "hermes-bots-groups": 4 }
    }));
  });

  it("rejects blank group names and blank group messages", async () => {
    const gateway = {
      request: vi.fn().mockResolvedValue({
        profiles: [{
          name: "default",
          ui_meta: {
            "hermes-bots-groups": {
              version: 3,
              rooms: {
                "id:room-1": { name: "Direction", roomId: "room-1", revision: 1, members: [{ name: "finance" }, { name: "ops" }], log: [] }
              }
            }
          }
        }]
      }),
      subscribe: vi.fn().mockReturnValue(() => undefined)
    };
    const service = new GroupChatService(gateway);

    await expect(service.createGroup(" ", ["finance", "ops"])).rejects.toThrow("Group name is required");
    await expect(service.sendMessage("room-1", " ")).rejects.toThrow("Group message is required");
  });

  it("runs Bot turns serially, records native replies, and ignores pass text", async () => {
    let listener: ((event: any) => void) | undefined;
    let projection: any = {
      version: 3,
      rooms: {
        "id:room-1": {
          name: "Direction",
          roomId: "room-1",
          revision: 1,
          members: [{ name: "finance" }, { name: "ops" }, { name: "specs" }, { name: "leads" }],
          log: []
        }
      }
    };
    const gateway = {
      subscribe: vi.fn((next: (event: any) => void) => { listener = next; return () => undefined; }),
      request: vi.fn(async (method: string, params: any = {}) => {
        if (method === "profiles.list") return { profiles: [{ name: "default", ui_meta: { "hermes-bots-groups": projection }, ui_meta_revisions: { "hermes-bots-groups": 1 } }] };
        if (method === "profiles.configure") {
          projection = params.ui_meta["hermes-bots-groups"];
          return { applied: { ui_meta: true } };
        }
        if (method === "session.list") return { sessions: [] };
        if (method === "session.create") return { session_id: `session-${params.profile}`, stored_session_id: `stored-${params.profile}` };
        if (method === "session.title") return { ok: true };
        if (method === "prompt.submit") return { accepted: true };
        throw new Error(`unexpected ${method}`);
      })
    };
    const service = new GroupChatService(gateway, () => "message-id");

    const started = await service.sendMessage("room-1", "Preparez une recommandation");
    expect(started.running).toBe(true);
    expect(gateway.request).toHaveBeenCalledWith("session.create", expect.objectContaining({
      profile: "finance",
      title: "Group: room-1",
      hidden: true,
      room_plumbing: true,
      follow_profile_config: true
    }));
    expect(gateway.request).toHaveBeenCalledWith("prompt.submit", expect.objectContaining({ session_id: "session-finance" }));

    listener!({ type: "message.complete", sessionId: "session-finance", payload: { text: "Finance valide le budget." } });
    await vi.waitFor(() => expect(gateway.request).toHaveBeenCalledWith("prompt.submit", expect.objectContaining({ session_id: "session-ops" })));

    listener!({ type: "message.complete", sessionId: "session-ops", payload: { text: "[PASS]" } });
    await vi.waitFor(() => expect(gateway.request).toHaveBeenCalledWith("prompt.submit", expect.objectContaining({ session_id: "session-specs" })));

    listener!({ type: "message.complete", sessionId: "session-specs", payload: { text: "pass" } });
    await vi.waitFor(() => expect(gateway.request).toHaveBeenCalledWith("prompt.submit", expect.objectContaining({ session_id: "session-leads" })));

    listener!({ type: "message.complete", sessionId: "session-leads", payload: { text: "" } });
    await vi.waitFor(async () => expect((await service.listGroups())[0].running).toBe(false));
    expect(projection.rooms["id:room-1"].log.map((message: any) => [message.from.kind, message.from.name, message.text])).toEqual([
      ["user", "You", "Preparez une recommandation"],
      ["member", "finance", "Finance valide le budget."]
    ]);
  });

  it("targets explicit mentions and lets a Bot hand off to another mentioned member", async () => {
    let listener: ((event: any) => void) | undefined;
    let projection: any = {
      version: 3,
      rooms: {
        "id:room-1": {
          name: "Direction",
          roomId: "room-1",
          revision: 1,
          members: [{ name: "finance" }, { name: "ops" }, { name: "specs" }],
          log: []
        }
      }
    };
    const gateway = {
      subscribe: vi.fn((next: (event: any) => void) => { listener = next; return () => undefined; }),
      request: vi.fn(async (method: string, params: any = {}) => {
        if (method === "profiles.list") return { profiles: [{ name: "default", ui_meta: { "hermes-bots-groups": projection } }] };
        if (method === "profiles.configure") {
          projection = params.ui_meta["hermes-bots-groups"];
          return { applied: { ui_meta: true } };
        }
        if (method === "session.list") return { sessions: [] };
        if (method === "session.create") return { session_id: `session-${params.profile}` };
        if (method === "prompt.submit") return { accepted: true };
        throw new Error(`unexpected ${method}`);
      })
    };
    const service = new GroupChatService(gateway, () => "message-id");

    await service.sendMessage("room-1", "@finance vérifie le budget");
    expect(gateway.request).toHaveBeenCalledWith("session.create", expect.objectContaining({ profile: "finance" }));
    expect(gateway.request).not.toHaveBeenCalledWith("session.create", expect.objectContaining({ profile: "ops" }));

    listener!({ type: "message.complete", sessionId: "session-finance", payload: { text: "Budget validé. @ops peux-tu confirmer le planning ?" } });
    await vi.waitFor(() => expect(gateway.request).toHaveBeenCalledWith("session.create", expect.objectContaining({ profile: "ops" })));

    listener!({ type: "message.complete", sessionId: "session-ops", payload: { text: "Planning confirmé. @finance" } });
    await vi.waitFor(() => expect(gateway.request.mock.calls.filter(([method, params]) => method === "prompt.submit" && params.session_id === "session-finance")).toHaveLength(2));
    listener!({ type: "message.complete", sessionId: "session-finance", payload: { text: "(pass)" } });
    await vi.waitFor(async () => expect((await service.listGroups())[0].running).toBe(false));
    expect(gateway.request).not.toHaveBeenCalledWith("session.create", expect.objectContaining({ profile: "specs" }));
    expect(gateway.request.mock.calls.filter(([method]) => method === "prompt.submit")).toHaveLength(3);
  });

  it("interrupts the active Hermes session when a group run is stopped", async () => {
    let projection: any = { version: 3, rooms: { "id:room-1": { name: "Direction", roomId: "room-1", members: [{ name: "finance" }, { name: "ops" }], log: [] } } };
    const gateway = {
      subscribe: vi.fn().mockReturnValue(() => undefined),
      request: vi.fn(async (method: string, params: any = {}) => {
        if (method === "profiles.list") return { profiles: [{ name: "default", ui_meta: { "hermes-bots-groups": projection } }] };
        if (method === "profiles.configure") { projection = params.ui_meta["hermes-bots-groups"]; return { applied: { ui_meta: true } }; }
        if (method === "session.list") return { sessions: [] };
        if (method === "session.create") return { session_id: `session-${params.profile}` };
        if (method === "prompt.submit") return { accepted: true };
        if (method === "session.interrupt") return { interrupted: true };
        throw new Error(`unexpected ${method}`);
      })
    };
    const service = new GroupChatService(gateway, () => "message-id");
    await service.sendMessage("room-1", "Faites le point");

    await expect(service.stop("room-1")).resolves.toMatchObject({
      running: false,
      protocol: { status: "stopped" },
      activity: [{ kind: "stopped" }]
    });
    expect(gateway.request).toHaveBeenCalledWith("session.interrupt", { session_id: "session-finance" });
  });

  it("isolates a typed member failure and continues the serial round", async () => {
    let listener: ((event: any) => void) | undefined;
    let projection: any = { version: 3, rooms: { "id:room-1": { name: "Direction", roomId: "room-1", members: [{ name: "finance" }, { name: "ops" }], log: [] } } };
    const gateway = {
      subscribe: vi.fn((next: (event: any) => void) => { listener = next; return () => undefined; }),
      request: vi.fn(async (method: string, params: any = {}) => {
        if (method === "profiles.list") return { profiles: [{ name: "default", ui_meta: { "hermes-bots-groups": projection } }] };
        if (method === "profiles.configure") { projection = params.ui_meta["hermes-bots-groups"]; return { applied: { ui_meta: true } }; }
        if (method === "session.list") return { sessions: [] };
        if (method === "session.create") return { session_id: `session-${params.profile}` };
        if (method === "prompt.submit") return { accepted: true };
        throw new Error(`unexpected ${method}`);
      })
    };
    const service = new GroupChatService(gateway, () => "message-id");
    await service.sendMessage("room-1", "Faites le point");

    listener!({ type: "message.complete", sessionId: "session-finance", payload: { status: "error", error: "429 too many requests", failure_reason: "provider_rate_limit" } });
    await vi.waitFor(() => expect(gateway.request).toHaveBeenCalledWith("prompt.submit", expect.objectContaining({ session_id: "session-ops" })));
    await expect(service.listGroups()).resolves.toMatchObject([{ running: true, activity: [{ kind: "failed", member: "finance", failure: { reason: "provider_rate_limit" } }] }]);

    listener!({ type: "message.complete", sessionId: "session-ops", payload: { text: "(pass)" } });
    await vi.waitFor(async () => expect((await service.listGroups())[0].running).toBe(false));
  });

  it("contains asynchronous group event failures and stops the affected run", async () => {
    let listener: ((event: any) => void) | undefined;
    let failNextRead = false;
    let projection: any = { version: 3, rooms: { "id:room-1": { name: "Direction", roomId: "room-1", members: [{ name: "finance" }, { name: "ops" }], log: [] } } };
    const gateway = {
      subscribe: vi.fn((next: (event: any) => void) => { listener = next; return () => undefined; }),
      request: vi.fn(async (method: string, params: any = {}) => {
        if (method === "profiles.list") {
          if (failNextRead) {
            failNextRead = false;
            throw new Error("profile state unavailable");
          }
          return { profiles: [{ name: "default", ui_meta: { "hermes-bots-groups": projection } }] };
        }
        if (method === "profiles.configure") { projection = params.ui_meta["hermes-bots-groups"]; return { applied: { ui_meta: true } }; }
        if (method === "session.list") return { sessions: [] };
        if (method === "session.create") return { session_id: `session-${params.profile}` };
        if (method === "prompt.submit") return { accepted: true };
        throw new Error(`unexpected ${method}`);
      })
    };
    const service = new GroupChatService(gateway, () => "message-id");
    await service.sendMessage("room-1", "Faites le point");

    failNextRead = true;
    listener!({ type: "message.complete", sessionId: "session-finance", payload: { text: "Terminé" } });

    await vi.waitFor(async () => expect((await service.listGroups())[0]).toMatchObject({
      running: false,
      activity: [{ kind: "failed", member: "finance", failure: { reason: "unknown" } }]
    }));
  });

  it("clears a group run when its first state refresh fails", async () => {
    let reads = 0;
    let projection: any = { version: 3, rooms: { "id:room-1": { name: "Direction", roomId: "room-1", members: [{ name: "finance" }, { name: "ops" }], log: [] } } };
    const gateway = {
      subscribe: vi.fn().mockReturnValue(() => undefined),
      request: vi.fn(async (method: string, params: any = {}) => {
        if (method === "profiles.list") {
          reads += 1;
          if (reads === 2) throw new Error("profile state unavailable");
          return { profiles: [{ name: "default", ui_meta: { "hermes-bots-groups": projection } }] };
        }
        if (method === "profiles.configure") { projection = params.ui_meta["hermes-bots-groups"]; return { applied: { ui_meta: true } }; }
        throw new Error(`unexpected ${method}`);
      })
    };
    const service = new GroupChatService(gateway, () => "message-id");

    await expect(service.sendMessage("room-1", "Faites le point")).rejects.toThrow("profile state unavailable");
    await expect(service.listGroups()).resolves.toMatchObject([{
      running: false,
      activity: [{ kind: "failed", member: "finance", failure: { reason: "unknown" } }]
    }]);
  });
});
