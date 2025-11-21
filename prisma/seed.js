const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const email = process.env.MAIN_ADMIN_EMAIL ;
  const pass  = process.env.MAIN_ADMIN_PASSWORD ;
  const hash  = bcrypt.hashSync(pass, 10);

  await prisma.admin.upsert({
    where: { email },
    update: {},
    create: { email, password: hash }
  });
  

  // Define all 5 buses with their routes
  const busData = [
    {
      number: '101',
      name: 'Bus 101',
      location: 'Vijayawada',
      morningStops: [
        { name: 'Vijayawada Railway Station', lat: 16.5062, lng: 80.6480 },
        { name: 'Benz Circle', lat: 16.5171, lng: 80.6305 },
        { name: 'Prakasham Barrage', lat: 16.5200, lng: 80.6250 },
        { name: 'V R Siddhartha Engineering College', lat: 16.5286, lng: 80.6393 }
      ],
      eveningStops: [
        { name: 'V R Siddhartha Engineering College', lat: 16.5286, lng: 80.6393 },
        { name: 'Prakasham Barrage', lat: 16.5200, lng: 80.6250 },
        { name: 'Benz Circle', lat: 16.5171, lng: 80.6305 },
        { name: 'Vijayawada Railway Station', lat: 16.5062, lng: 80.6480 }
      ]
    },
    {
      number: '102',
      name: 'Bus 102',
      location: 'Guntur',
      morningStops: [
        { name: 'Guntur Railway Station', lat: 16.3008, lng: 80.4428 },
        { name: 'Amaravati Road', lat: 16.3500, lng: 80.5000 },
        { name: 'Mangalagiri', lat: 16.4000, lng: 80.5500 },
        { name: 'Amaravati', lat: 16.4500, lng: 80.6000 },
        { name: 'V R Siddhartha Engineering College', lat: 16.5286, lng: 80.6393 }
      ],
      eveningStops: [
        { name: 'V R Siddhartha Engineering College', lat: 16.5286, lng: 80.6393 },
        { name: 'Amaravati', lat: 16.4500, lng: 80.6000 },
        { name: 'Mangalagiri', lat: 16.4000, lng: 80.5500 },
        { name: 'Amaravati Road', lat: 16.3500, lng: 80.5000 },
        { name: 'Guntur Railway Station', lat: 16.3008, lng: 80.4428 }
      ]
    },
    {
    number: '1010',
    name: 'Bus 101',
    location: 'Vijayawada',
    eveningStops: [
      { name: 'Stop 1', lat: 16.484153, lng: 80.692137 },
      { name: 'Stop 2', lat: 16.523096, lng: 80.666400 },
      { name: 'Stop 3', lat: 16.523005, lng: 80.663495 },
      { name: 'Stop 4', lat: 16.524847, lng: 80.657475 },
      { name: 'Stop 5', lat: 16.521359, lng: 80.653524 },
      { name: 'Stop 6', lat: 16.519305, lng: 80.652200 },
      { name: 'Stop 7', lat: 16.516474, lng: 80.643017 },
      { name: 'Stop 8', lat: 16.516071, lng: 80.639715 },
      { name: 'Stop 9', lat: 16.519295, lng: 80.626558 },
      { name: 'Stop 10', lat: 16.522903, lng: 80.628501 },
      { name: 'Stop 11', lat: 16.524799, lng: 80.631096 },
      { name: 'Stop 12', lat: 16.526844, lng: 80.633842 },
      { name: 'Stop 13', lat: 16.546764, lng: 80.648805 },
      { name: 'Stop 14', lat: 16.547663, lng: 80.651151 },
      { name: 'Stop 15', lat: 16.548047, lng: 80.652865 },
      { name: 'Stop 16', lat: 16.576917, lng: 80.684021 }
    ],
    morningStops: [
      { name: 'Stop 16', lat: 16.576917, lng: 80.684021 },
      { name: 'Stop 15', lat: 16.547597, lng: 80.651979 },
      { name: 'Stop 14', lat: 16.547080, lng: 80.650625 },
      { name: 'Stop 13', lat: 16.547054, lng: 80.650561 },
      { name: 'Stop 12', lat: 16.544392, lng: 80.643775 },
      { name: 'Stop 11', lat: 16.541750, lng: 80.637520 },
      { name: 'Stop 10', lat: 16.539500, lng: 80.637000 },
      { name: 'Stop 9', lat: 16.537187, lng: 80.636404 },
      { name: 'Stop 8', lat: 16.530038, lng: 80.638173 },
      { name: 'Stop 7', lat: 16.528783, lng: 80.637860 },
      { name: 'Stop 6', lat: 16.526895, lng: 80.633891 },
      { name: 'Stop 5', lat: 16.524212, lng: 80.630945 },
      { name: 'Stop 4', lat: 16.519730, lng: 80.627047 },
      { name: 'Stop 3', lat: 16.514263, lng: 80.632328 },
      { name: 'Stop 2', lat: 16.516080, lng: 80.639407 },
      { name: 'Stop 1', lat: 16.516815, lng: 80.642825 },
      { name: 'Stop 0', lat: 16.517497, lng: 80.645346 },
      { name: 'Stop -1', lat: 16.518100, lng: 80.647487 },
      { name: 'Stop -2', lat: 16.519159, lng: 80.651811 },
      { name: 'Stop -3', lat: 16.521330, lng: 80.653590 },
      { name: 'Stop -4', lat: 16.523603, lng: 80.655555 },
      { name: 'Stop -5', lat: 16.523126, lng: 80.663492 },
      { name: 'Stop -6', lat: 16.524104, lng: 80.672052 },
      { name: 'Stop 1 (return)', lat: 16.484153, lng: 80.692137 }
    ]
  },
    {
      number: '103',
      name: 'Bus 103',
      location: 'Kanuru',
      morningStops: [
        { name: 'Kanuru Junction', lat: 16.5200, lng: 80.6200 },
        { name: 'NTR Circle', lat: 16.5250, lng: 80.6300 },
        { name: 'V R Siddhartha Engineering College', lat: 16.5286, lng: 80.6393 }
      ],
      eveningStops: [
        { name: 'V R Siddhartha Engineering College', lat: 16.5286, lng: 80.6393 },
        { name: 'NTR Circle', lat: 16.5250, lng: 80.6300 },
        { name: 'Kanuru Junction', lat: 16.5200, lng: 80.6200 }
      ]
    },
    {
      number: '104',
      name: 'Bus 104',
      location: 'Machilipatnam',
      morningStops: [
        { name: 'Machilipatnam Bus Stand', lat: 16.1667, lng: 81.1333 },
        { name: 'Gudivada', lat: 16.2500, lng: 80.9000 },
        { name: 'Nuzvid', lat: 16.3500, lng: 80.7500 },
        { name: 'Mangalagiri', lat: 16.4000, lng: 80.5500 },
        { name: 'V R Siddhartha Engineering College', lat: 16.5286, lng: 80.6393 }
      ],
      eveningStops: [
        { name: 'V R Siddhartha Engineering College', lat: 16.5286, lng: 80.6393 },
        { name: 'Mangalagiri', lat: 16.4000, lng: 80.5500 },
        { name: 'Nuzvid', lat: 16.3500, lng: 80.7500 },
        { name: 'Gudivada', lat: 16.2500, lng: 80.9000 },
        { name: 'Machilipatnam Bus Stand', lat: 16.1667, lng: 81.1333 }
      ]
    },
    {
      number: '105',
      name: 'Bus 105',
      location: 'Eluru',
      morningStops: [
        { name: 'Eluru Railway Station', lat: 16.7000, lng: 81.1000 },
        { name: 'Gudivada', lat: 16.2500, lng: 80.9000 },
        { name: 'Nuzvid', lat: 16.3500, lng: 80.7500 },
        { name: 'Mangalagiri', lat: 16.4000, lng: 80.5500 },
        { name: 'V R Siddhartha Engineering College', lat: 16.5286, lng: 80.6393 }
      ],
      eveningStops: [
        { name: 'V R Siddhartha Engineering College', lat: 16.5286, lng: 80.6393 },
        { name: 'Mangalagiri', lat: 16.4000, lng: 80.5500 },
        { name: 'Nuzvid', lat: 16.3500, lng: 80.7500 },
        { name: 'Gudivada', lat: 16.2500, lng: 80.9000 },
        { name: 'Eluru Railway Station', lat: 16.7000, lng: 81.1000 }
      ]
    }
  ];

  // Create buses and their stops
  for (const busInfo of busData) {
    const bus = await prisma.bus.upsert({
      where: { number: busInfo.number },
      update: {},
      create: {
        number: busInfo.number,
        name: busInfo.name,
        location: busInfo.location,
        capacity: 60,
        currentOccupancy: 0
      }
    });

    // Clear existing stops for this bus
    await prisma.stop.deleteMany({ where: { busId: bus.id } });

    // Add morning stops
    for (let i = 0; i < busInfo.morningStops.length; i++) {
      const stop = busInfo.morningStops[i];
      await prisma.stop.create({
        data: {
          name: stop.name,
          lat: stop.lat,
          lng: stop.lng,
          period: 'MORNING',
          order: i + 1,
          busId: bus.id
        }
      });
    }

    // Add evening stops
    for (let i = 0; i < busInfo.eveningStops.length; i++) {
      const stop = busInfo.eveningStops[i];
      await prisma.stop.create({
        data: {
          name: stop.name,
          lat: stop.lat,
          lng: stop.lng,
          period: 'EVENING',
          order: i + 1,
          busId: bus.id
        }
      });
    }
  }

  console.log('✅ Seeded 5 buses with complete routes');
}

main().then(()=>prisma.$disconnect()).catch(e=>{console.error(e);process.exit(1);});