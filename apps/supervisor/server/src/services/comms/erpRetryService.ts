import { ADMIN_USERNAME } from "@naisys/common";

import { hubDb } from "../../database/hubDb.js";
import { sendMailViaHub } from "./hubConnectionService.js";

export async function notifyErpRetry(notification: {
  managerUuid: string;
  deliveryKey: string;
  body: string;
}) {
  const manager = await hubDb.users.findUnique({
    where: { uuid: notification.managerUuid },
  });
  const admin = await hubDb.users.findUnique({
    where: { username: ADMIN_USERNAME },
  });
  if (!manager || !admin || !manager.enabled || manager.archived) {
    throw new Error("ERP retry manager or sender is unavailable");
  }
  const response = await sendMailViaHub(
    admin.id,
    [manager.id],
    "",
    notification.body,
    "chat",
    undefined,
    notification.deliveryKey,
  );
  if (!response.success)
    throw new Error(response.error || "ERP retry delivery failed");
}
