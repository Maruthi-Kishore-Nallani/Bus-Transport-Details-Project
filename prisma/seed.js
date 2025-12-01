const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  const email = process.env.MAIN_ADMIN_EMAIL ;
  const pass  = process.env.MAIN_ADMIN_PASSWORD ;
  const hash  = bcrypt.hashSync(pass, 10);

  // Check if Admin table has 'approved' column
  let hasApprovedColumn = false;
  try {
    const result = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Admin' AND column_name = 'approved'
    `;
    hasApprovedColumn = result && result.length > 0;
  } catch (e) {
    console.log('Could not check for approved column, assuming it does not exist');
  }

  // Upsert admin with or without approved field
  if (hasApprovedColumn) {
    await prisma.admin.upsert({
      where: { email },
      update: { approved: true },
      create: { email, password: hash, approved: true }
    });
  } else {
    await prisma.admin.upsert({
      where: { email },
      update: {},
      create: { email, password: hash }
    });
  }
  
  console.log('✓ Admin user created/updated');

  // Define all buses with their routes
  
  const busData = [
    {
      number: '1',
      name: 'APXXYYZZZZ',
      location: 'Location_1',
      driverName: 'XXXX',
      driverPhone: 'YYYYYYYYYY',
      liveLocationUrl: '',
      capacity: 60,
      morningStops: [],
      eveningStops: []
    },
    {
      number: '2',
      name: 'AP39UY7589',
      location: 'Location_2',
      driverName: 'B Karthik',
      driverPhone: '7036619577',
      liveLocationUrl: 'https://tinyurl.com/yj2xaaw7',
      capacity: 60,
      morningStops: [
        { name: 'Stop 1', lat: 16.198695, lng: 81.148362 },
        { name: 'Stop 2', lat: 16.192784, lng: 81.142747 },
        { name: 'Stop 3', lat: 16.181148, lng: 81.130006 },
        { name: 'Stop 4', lat: 16.183537, lng: 81.128035 },
        { name: 'Stop 5', lat: 16.190267, lng: 81.122696 },
        { name: 'Stop 6', lat: 16.214409, lng: 81.077548 },
        { name: 'Stop 7', lat: 16.324227, lng: 80.961410 },
        { name: 'Stop 8', lat: 16.362069, lng: 80.877701 },
        { name: 'Stop 9', lat: 16.360922, lng: 80.850862 },
        { name: 'Stop 10', lat: 16.360796, lng: 80.847118 },
        { name: 'Stop 11', lat: 16.360078, lng: 80.844382 },
        { name: 'Stop 12', lat: 16.365839, lng: 80.841941 },
        { name: 'Stop 13', lat: 16.482109, lng: 80.691247 }
      ],
      eveningStops: [
        { name: 'Stop 1', lat: 16.482109, lng: 80.691247 },
        { name: 'Stop 2', lat: 16.365839, lng: 80.841941 },
        { name: 'Stop 3', lat: 16.360078, lng: 80.844382 },
        { name: 'Stop 4', lat: 16.360796, lng: 80.847118 },
        { name: 'Stop 5', lat: 16.360922, lng: 80.850862 },
        { name: 'Stop 6', lat: 16.362069, lng: 80.877701 },
        { name: 'Stop 7', lat: 16.324227, lng: 80.961410 },
        { name: 'Stop 8', lat: 16.214409, lng: 81.077548 },
        { name: 'Stop 9', lat: 16.190267, lng: 81.122696 },
        { name: 'Stop 10', lat: 16.183537, lng: 81.128035 },
        { name: 'Stop 11', lat: 16.181148, lng: 81.130006 },
        { name: 'Stop 12', lat: 16.192784, lng: 81.142747 },
        { name: 'Stop 13', lat: 16.198695, lng: 81.148362 }
      ]
    },
    {
      number: '3',
      name: 'AP39UY7593',
      location: 'Location_3',
      driverName: 'G Venkata Ramana',
      driverPhone: '9951888155',
      liveLocationUrl: 'https://tinyurl.com/547z553f',
      capacity: 60,
      morningStops: [
        { name: 'Stop 1', lat: 16.635383, lng: 80.970853 },
        { name: 'Stop 2', lat: 16.634673, lng: 80.966671 },
        { name: 'Stop 3', lat: 16.633663, lng: 80.961908 },
        { name: 'Stop 4', lat: 16.632404, lng: 80.955820 },
        { name: 'Stop 5', lat: 16.629240, lng: 80.955670 },
        { name: 'Stop 6', lat: 16.630533, lng: 80.949398 },
        { name: 'Stop 7', lat: 16.610848, lng: 80.913394 },
        { name: 'Stop 8', lat: 16.608412, lng: 80.907411 },
        { name: 'Stop 9', lat: 16.597352, lng: 80.893695 },
        { name: 'Stop 10', lat: 16.591430, lng: 80.886198 },
        { name: 'Stop 11', lat: 16.573088, lng: 80.863216 },
        { name: 'Stop 12', lat: 16.552011, lng: 80.826206 },
        { name: 'Stop 13', lat: 16.543586, lng: 80.809599 },
        { name: 'Stop 14', lat: 16.541026, lng: 80.803155 },
        { name: 'Stop 15', lat: 16.539984, lng: 80.801112 },
        { name: 'Stop 16', lat: 16.537832, lng: 80.797463 },
        { name: 'Stop 17', lat: 16.521686, lng: 80.776579 },
        { name: 'Stop 18', lat: 16.512376, lng: 80.749756 },
        { name: 'Stop 19', lat: 16.509585, lng: 80.724326 },
        { name: 'Stop 20', lat: 16.509416, lng: 80.720135 },
        { name: 'Stop 21', lat: 16.516784, lng: 80.700174 },
        { name: 'Stop 22', lat: 16.520277, lng: 80.693135 },
        { name: 'Stop 23', lat: 16.522325, lng: 80.689023 },
        { name: 'Stop 24', lat: 16.524174, lng: 80.684606 },
        { name: 'Stop 25', lat: 16.524357, lng: 80.679993 },
        { name: 'Stop 26', lat: 16.520209, lng: 80.675372 },
        { name: 'Stop 27', lat: 16.515564, lng: 80.670319 },
        { name: 'Stop 28', lat: 16.509609, lng: 80.676973 },
        { name: 'Stop 29', lat: 16.491763, lng: 80.668857 },
        { name: 'Stop 30', lat: 16.482109, lng: 80.691247 }
      ],
      eveningStops: [
        { name: 'Stop 1', lat: 16.489895, lng: 80.672213 },
        { name: 'Stop 2', lat: 16.508506, lng: 80.677335 },
        { name: 'Stop 3', lat: 16.511072, lng: 80.674505 },
        { name: 'Stop 4', lat: 16.522428, lng: 80.688624 },
        { name: 'Stop 5', lat: 16.520043, lng: 80.693164 },
        { name: 'Stop 6', lat: 16.511152, lng: 80.715628 },
        { name: 'Stop 7', lat: 16.509813, lng: 80.718775 },
        { name: 'Stop 8', lat: 16.510613, lng: 80.730426 },
        { name: 'Stop 9', lat: 16.511679, lng: 80.740032 },
        { name: 'Stop 10', lat: 16.512796, lng: 80.750266 },
        { name: 'Stop 11', lat: 16.521546, lng: 80.775700 },
        { name: 'Stop 12', lat: 16.537606, lng: 80.796569 },
        { name: 'Stop 13', lat: 16.539886, lng: 80.800522 },
        { name: 'Stop 14', lat: 16.541728, lng: 80.804484 },
        { name: 'Stop 15', lat: 16.543166, lng: 80.807550 },
        { name: 'Stop 16', lat: 16.571937, lng: 80.861817 },
        { name: 'Stop 17', lat: 16.590683, lng: 80.885244 },
        { name: 'Stop 18', lat: 16.598046, lng: 80.893667 },
        { name: 'Stop 19', lat: 16.608724, lng: 80.907169 },
        { name: 'Stop 20', lat: 16.611271, lng: 80.912838 },
        { name: 'Stop 21', lat: 16.613489, lng: 80.923254 },
        { name: 'Stop 22', lat: 16.629461, lng: 80.945824 },
        { name: 'Stop 23', lat: 16.632194, lng: 80.953630 },
        { name: 'Stop 24', lat: 16.632824, lng: 80.957478 },
        { name: 'Stop 25', lat: 16.634752, lng: 80.967185 },
        { name: 'Stop 26', lat: 16.635359, lng: 80.970527 }
      ]
    },
    
    {
      number: '4',
      name: 'AP39UY7592',
      location: 'Location_4',
      driverName: 'D Sydhulu',
      driverPhone: '9618221130',
      liveLocationUrl: 'https://tinyurl.com/4z5by6ca',
      capacity: 60,
      morningStops: [
        { name: 'Stop 1', lat: 16.576917, lng: 80.684021 },
        { name: 'Stop 2', lat: 16.547597, lng: 80.651979 },
        { name: 'Stop 3', lat: 16.547080, lng: 80.650625 },
        { name: 'Stop 4', lat: 16.547054, lng: 80.650561 },
        { name: 'Stop 5', lat: 16.544392, lng: 80.643775 },
        { name: 'Stop 6', lat: 16.541750, lng: 80.637520 },
        { name: 'Stop 7', lat: 16.539500, lng: 80.637000 },
        { name: 'Stop 8', lat: 16.537187, lng: 80.636404 },
        { name: 'Stop 9', lat: 16.530038, lng: 80.638173 },
        { name: 'Stop 10', lat: 16.528783, lng: 80.637860 },
        { name: 'Stop 11', lat: 16.526895, lng: 80.633891 },
        { name: 'Stop 12', lat: 16.524212, lng: 80.630945 },
        { name: 'Stop 13', lat: 16.519730, lng: 80.627047 },
        { name: 'Stop 14', lat: 16.514263, lng: 80.632328 },
        { name: 'Stop 15', lat: 16.516080, lng: 80.639407 },
        { name: 'Stop 16', lat: 16.516815, lng: 80.642825 },
        { name: 'Stop 17', lat: 16.517497, lng: 80.645346 },
        { name: 'Stop 18', lat: 16.518100, lng: 80.647487 },
        { name: 'Stop 19', lat: 16.519159, lng: 80.651811 },
        { name: 'Stop 20', lat: 16.521330, lng: 80.653590 },
        { name: 'Stop 21', lat: 16.523603, lng: 80.655555 },
        { name: 'Stop 22', lat: 16.523126, lng: 80.663492 },
        { name: 'Stop 23', lat: 16.524104, lng: 80.672052 },
        { name: 'Stop 24', lat: 16.484153, lng: 80.692137 }
      ],
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
      ]
    },
    {
      number: '5',
      name: 'APXXYYZZZZ',
      location: 'Location_5',
      driverName: 'XXXX',
      driverPhone: 'YYYYYYYYYY',
      liveLocationUrl: '',
      capacity: 60,
      morningStops: [],
      eveningStops: []
    },
    {
      number: '6',
      name: 'AP39UY7591',
      location: 'Location_6',
      driverName: 'M Nageswar Rao',
      driverPhone: '9000320526',
      liveLocationUrl: 'https://tinyurl.com/mbfhexfs',
      capacity: 60,
      morningStops: [
        { name: 'Stop 1', lat: 16.297546, lng: 80.431766 },
        { name: 'Stop 2', lat: 16.293237, lng: 80.449373 },
        { name: 'Stop 3', lat: 16.293375, lng: 80.454572 },
        { name: 'Stop 4', lat: 16.297458, lng: 80.456370 },
        { name: 'Stop 5', lat: 16.319175, lng: 80.472875 },
        { name: 'Stop 6', lat: 16.408375, lng: 80.555863 },
        { name: 'Stop 7', lat: 16.421243, lng: 80.572672 },
        { name: 'Stop 8', lat: 16.424843, lng: 80.576235 },
        { name: 'Stop 9', lat: 16.427040, lng: 80.578078 },
        { name: 'Stop 10', lat: 16.431065, lng: 80.581573 },
        { name: 'Stop 11', lat: 16.437460, lng: 80.586513 },
        { name: 'Stop 12', lat: 16.480417, lng: 80.618007 },
        { name: 'Stop 13', lat: 16.483497, lng: 80.619440 },
        { name: 'Stop 14', lat: 16.500233, lng: 80.632368 },
        { name: 'Stop 15', lat: 16.499620, lng: 80.637510 },
        { name: 'Stop 16', lat: 16.496427, lng: 80.642668 },
        { name: 'Stop 17', lat: 16.496290, lng: 80.651622 },
        { name: 'Stop 18', lat: 16.484214, lng: 80.690631 }
      ],
      eveningStops: [
        { name: 'Stop 1', lat: 16.484214, lng: 80.690631 },
        { name: 'Stop 2', lat: 16.496290, lng: 80.651622 },
        { name: 'Stop 3', lat: 16.496427, lng: 80.642668 },
        { name: 'Stop 4', lat: 16.499620, lng: 80.637510 },
        { name: 'Stop 5', lat: 16.500233, lng: 80.632368 },
        { name: 'Stop 6', lat: 16.483497, lng: 80.619440 },
        { name: 'Stop 7', lat: 16.480417, lng: 80.618007 },
        { name: 'Stop 8', lat: 16.437460, lng: 80.586513 },
        { name: 'Stop 9', lat: 16.431065, lng: 80.581573 },
        { name: 'Stop 10', lat: 16.427040, lng: 80.578078 },
        { name: 'Stop 11', lat: 16.424843, lng: 80.576235 },
        { name: 'Stop 12', lat: 16.421243, lng: 80.572672 },
        { name: 'Stop 13', lat: 16.408375, lng: 80.555863 },
        { name: 'Stop 14', lat: 16.319175, lng: 80.472875 },
        { name: 'Stop 15', lat: 16.297458, lng: 80.456370 },
        { name: 'Stop 16', lat: 16.293375, lng: 80.454572 },
        { name: 'Stop 17', lat: 16.293237, lng: 80.449373 },
        { name: 'Stop 18', lat: 16.297546, lng: 80.431766 }
      ]
    },
    {
      number: '7',
      name: 'AP39UY7594',
      location: 'Location_7',
      driverName: 'K Subramanyam',
      driverPhone: '6304413347',
      liveLocationUrl: 'https://tinyurl.com/2hsm5mys',
      capacity: 60,
      morningStops: [
        { name: 'Stop 1', lat: 16.521810, lng: 80.628261 },
        { name: 'Stop 2', lat: 16.521192, lng: 80.638601 },
        { name: 'Stop 3', lat: 16.522685, lng: 80.644597 },
        { name: 'Stop 4', lat: 16.524123, lng: 80.654142 },
        { name: 'Stop 5', lat: 16.523220, lng: 80.666307 },
        { name: 'Stop 6', lat: 16.519899, lng: 80.665703 },
        { name: 'Stop 7', lat: 16.509900, lng: 80.652972 },
        { name: 'Stop 8', lat: 16.508772, lng: 80.650908 },
        { name: 'Stop 9', lat: 16.505832, lng: 80.659325 },
        { name: 'Stop 10', lat: 16.502702, lng: 80.668413 },
        { name: 'Stop 11', lat: 16.482109, lng: 80.691247 }
      ],
      eveningStops: [
        { name: 'Stop 1', lat: 16.482109, lng: 80.691247 },
        { name: 'Stop 2', lat: 16.502702, lng: 80.668413 },
        { name: 'Stop 3', lat: 16.505832, lng: 80.659325 },
        { name: 'Stop 4', lat: 16.508772, lng: 80.650908 },
        { name: 'Stop 5', lat: 16.509900, lng: 80.652972 },
        { name: 'Stop 6', lat: 16.519899, lng: 80.665703 },
        { name: 'Stop 7', lat: 16.523220, lng: 80.666307 },
        { name: 'Stop 8', lat: 16.524123, lng: 80.654142 },
        { name: 'Stop 9', lat: 16.522685, lng: 80.644597 },
        { name: 'Stop 10', lat: 16.521192, lng: 80.638601 },
        { name: 'Stop 11', lat: 16.521810, lng: 80.628261 }
      ]
    }
  ];

  // Create buses and their stops
  for (const busInfo of busData) {
    const bus = await prisma.bus.upsert({
      where: { number: busInfo.number },
      update: {
        name: busInfo.name,
        location: busInfo.location,
        driverName: busInfo.driverName,
        driverPhone: busInfo.driverPhone,
        liveLocationUrl: busInfo.liveLocationUrl,
        capacity: busInfo.capacity
      },
      create: {
        number: busInfo.number,
        name: busInfo.name,
        location: busInfo.location,
        driverName: busInfo.driverName,
        driverPhone: busInfo.driverPhone,
        liveLocationUrl: busInfo.liveLocationUrl,
        capacity: busInfo.capacity,
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
    
    console.log(`✓ Seeded bus ${busInfo.number} (${busInfo.name}) with ${busInfo.morningStops.length} morning + ${busInfo.eveningStops.length} evening stops`);
  }

  console.log('✅ Database seeded successfully with 7 buses!');
}

main().then(()=>prisma.$disconnect()).catch(e=>{console.error(e);process.exit(1);});