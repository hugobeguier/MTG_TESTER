import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addLesson, deleteLesson, readLessons } from "@/lib/agentLessonStore";

const LessonInput = z.object({
  agentName: z.string().min(1),
  purpose: z.string().min(1),
  situation: z.string(),
  chose: z.string(),
  advice: z.string().min(1).max(2000)
});

export async function GET() {
  return NextResponse.json({ lessons: await readLessons() });
}

export async function POST(request: NextRequest) {
  const lesson = await addLesson(LessonInput.parse(await request.json()));
  return NextResponse.json({ lesson, lessons: await readLessons() });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (id) await deleteLesson(id);
  return NextResponse.json({ lessons: await readLessons() });
}
