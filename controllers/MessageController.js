import getPrismaInstance from "../utils/PrismaClient.js";
// import { renameSync } from "fs";

export const addMessage = async (req, res, next) => {
  try {
    const prisma = getPrismaInstance();
    const { message, from, to } = req.body;
    const getUser = onlineUsers.get(to);

    if (message && from && to) {
      const newMessage = await prisma.messages.create({
        data: {
          message,
          sender: { connect: { id: from } },
          receiver: { connect: { id: to } },
          messageStatus: getUser ? "delivered" : "sent",
        },
        include: { sender: true, receiver: true },
      });

      return res.status(201).send({ message: newMessage });
    }
    return res.status(400).send("From, to, and message are required.");
  } catch (err) {
    next(err);
  }
};


export const getMessages = async (req, res, next) => {
  try {
    const prisma = getPrismaInstance();
    const { from, to } = req.params;

    const messages = await prisma.messages.findMany({
      where: {
        OR: [
          { senderId: from, receiverId: to },
          { senderId: to, receiverId: from },
        ],
      },
      orderBy: { createdAt: "asc" },
    });

    const unreadMessages = messages
      .filter(
        (message) =>
          message.messageStatus !== "read" && message.senderId === to
      )
      .map((message) => message.id);

    if (unreadMessages.length > 0) {
      await prisma.messages.updateMany({
        where: { id: { in: unreadMessages } },
        data: { messageStatus: "read" },
      });
    }

    return res.status(200).json({ messages });
  } catch (err) {
    next(err);
  }
};


// export const addImageMessage = async (req, res, next) => {
//   try {
//     if (req.file) {
//       const date = Date.now();
//       let fileName = "uploads/images/"+date+req.file.originalname;
//       renameSync(req.file.path, fileName);

//       const prisma = getPrismaInstance();
//       const { from, to } = req.query;

//       if (from && to) {
//         const message = await prisma.messages.create({
//           data: {
//             message: fileName,
//             sender: { connect: { id: from } },
//             receiver: { connect: { id: to } },
//             type: "image",
//           },
//         });

//         return res.status(201).json({ message });
//       }
//       return res.status(400).send("From and to are required.");
//     }
//     return res.status(400).send("Image is required.");
//   } catch (err) {
//     next(err);
//   }
// };


// export const addAudioMessage = async (req, res, next) => {
//   try {
//     if (req.file) {
//       const date = Date.now();
//       const fileName = "uploads/recordings/"+date+req.file.originalname;
//       renameSync(req.file.path, fileName);

//       const prisma = getPrismaInstance();
//       const { from, to } = req.query;

//       if (from && to) {
//         const message = await prisma.messages.create({
//           data: {
//             message: fileName,
//             sender: { connect: { id: from } },
//             receiver: { connect: { id: to } },
//             type: "audio",
//           },
//         });

//         return res.status(201).json({ message });
//       }
//       return res.status(400).send("From and to are required.");
//     }
//     return res.status(400).send("Audio is required.");
//   } catch (err) {
//     next(err);
//   }
// };


export const getInitialContactsWithMessages = async (req, res, next) => {
  try {
    const userId = req.params.from;
    const prisma = getPrismaInstance();

    // Fetch user data including sent and received messages
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        sentMessages: {
          include: { receiver: true, sender: true },
          orderBy: { createdAt: "desc" },
        },
        receivedMessages: {
          include: { receiver: true, sender: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Merge and sort messages by creation date (descending)
    const messages = [...user.sentMessages, ...user.receivedMessages];
    messages.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const users = new Map();
    const messageStatusChange = [];

    messages.forEach((msg) => {
      const isSender = msg.senderId === userId;
      const calculatedId = isSender ? msg.receiverId : msg.senderId;

      // Collect message IDs where status is "sent" for bulk update
      if (msg.messageStatus === "sent") {
        messageStatusChange.push(msg.id);
      }

      const {
        id,
        type,
        message,
        messageStatus,
        createdAt,
        senderId,
        receiverId,
      } = msg;

      // Check if user is already added to the Map
      if (!users.get(calculatedId)) {
        let user = {
          messageId: id,
          type,
          message,
          messageStatus,
          createdAt,
          senderId,
          receiverId,
        };

        // Add additional details based on whether the user is the sender or receiver
        if (isSender) {
          user = {
            ...user,
            ...msg.receiver,
            totalUnreadMessages: 0,
          };
        } else {
          user = {
            ...user,
            ...msg.sender,
            totalUnreadMessages: messageStatus !== "read" ? 1 : 0,
          };
        }

        users.set(calculatedId, { ...user });
      } else if (!isSender && messageStatus !== "read") {
        const existingUser = users.get(calculatedId);
        users.set(calculatedId, {
          ...existingUser,
          totalUnreadMessages: existingUser.totalUnreadMessages + 1,
        });
      }
    });

    // Update message statuses to "delivered" for the collected IDs
    if (messageStatusChange.length) {
      await prisma.messages.updateMany({
        where: { id: { in: messageStatusChange } },
        data: { messageStatus: "delivered" },
      });
    }

    return res.status(200).json({
      users: Array.from(users.values()),
      onlineUsers: Array.from(onlineUsers.keys()),
    });
  } catch (err) {
    next(err);
  }
};


