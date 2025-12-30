export const emitNotification = (io, receiverId, notificationData) => {
  io.to(receiverId.toString()).emit("new_notification", {
    ...notificationData,
    createdAt: new Date(),
  });
};