import { NextRequest, NextResponse } from "next/server";
import { siteOrigin } from "@/lib/request";
import { currentUser } from "@/lib/auth";
import { createPortalSession } from "@/lib/billing";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const portal = await createPortalSession(user, siteOrigin(req));
  if (!portal) {
    return NextResponse.json({ error: "No billing profile yet." }, { status: 404 });
  }
  return NextResponse.json(portal);
}
