import prisma from "../prisma/client";

export async function isEngineerUser(userId: string): Promise<boolean> {
    const user = await prisma.users.findUnique({
        where: { id: userId },
        select: { role: true }
    });
    return user?.role === "Engineer";
}
