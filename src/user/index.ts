import express from "express";
import { apiHandler } from "../utils";
import prisma from "../prisma/client";
const router = express.Router({ mergeParams: true });

// router.get("/sign-up-finished", apiHandler(async (req, res) => {
//     let userId = req.userId!;
//     const user = await prisma.users_who_finished_sign_up.findFirst({ where: { user_id: userId } });
//     res.json({ signUpFinished: user !== null });
// }, true, ['v1']));

// router.put("/", apiHandler(async (req, res) => {
//     let userId = req.userId!;
//     let age = req.body.age;
//     let gender = req.body.gender;
//     let country = req.body.country;
//     let profession = req.body.profession;
//     let interests = req.body.interests;

//     if (age === null || gender === null || country === null || profession === null || interests === null) {
//         throw {
//             status: 400,
//             message: "Fields cannot be null"
//         };
//     }

//     await prisma.$transaction([
//         prisma.user_profile.upsert({
//             where: { user_id: userId },
//             update: { age, gender, country, profession, interests },
//             create: { user_id: userId, age, gender, country, profession, interests }
//         }),
//         prisma.users_who_finished_sign_up.upsert({
//             where: { user_id: userId },
//             update: { user_id: userId },
//             create: { user_id: userId }
//         })
//     ]);

//     res.json({ success: true });
// }, true, ['v1']));

// router.get("/", apiHandler(async (req, res) => {
//     let userId = req.userId!;
//     const user = await prisma.user_profile.findFirst({ where: { user_id: userId } });
//     if (user === null) {
//         res.json({ name: req.name });
//     } else {
//         res.json({
//             ...user,
//             name: req.name,
//             user_id: undefined
//         });
//     }
// }, true, ['v1']));

export default router;
